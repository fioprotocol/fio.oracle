require('dotenv').config();
import Web3 from "web3";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json";
import {addLogMessage, handleServerError, logDir} from "../helpers";
import * as process from "process";

// todo: 'ethereumjs-tx' has been deprecated, update to @ethereumjs/tx
const Tx = require('ethereumjs-tx').Transaction;

const fetch = require('node-fetch');
const fs = require('fs');

const ethereumChainLogPath = logDir + "ETH.log";
const tokensWrapTransactionLogPath = logDir + "WrapTransaction.log";
const domainWrapTransactionLogPath = logDir + "DomainWrapTransaction.log";
const tokensWrapTransactionErrLogPath = logDir + "WrapErrTransaction.log";
const domainWrapTransactionErrorLogPath = logDir + "DomainWrapErrTransaction.log";

var index = 0;
const { TextEncoder, TextDecoder } = require('text-encoding');

const gweiUnit = 1000000000;

class EthCtrl {
    constructor() {
        this.web3 = new Web3(process.env.ETHINFURA);
        this.fioContract = new this.web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, process.env.FIO_NFT_ETH_CONTRACT);
    }

    async wrapFioToken(txIdOnFioChain, wrapData) {
        const logPrefix = `ETH, wrapFioToken, FIO tx_id: ${txIdOnFioChain} --> `
        console.log(logPrefix + 'Executing wrapFioToken, data to wrap:');
        console.log(wrapData)
        try {
            const quantity = wrapData.amount;
            const info = await (await fetch(process.env.ETH_API_URL)).json();

            const gasMode = process.env.USEGASAPI;
            var gasPrice = 0;
            if ((gasMode == "1" && info.status === "1")||(gasMode == "0" && parseInt(process.env.TGASPRICE) <= 0)) {
                console.log(logPrefix + 'using gasPrice value from the api:');
                if (process.env.GASPRICELEVEL == "average") {
                    gasPrice = parseInt(info.result.ProposeGasPrice) * gweiUnit;
                } else if(process.env.GASPRICELEVEL == "low") {
                    gasPrice = parseInt(info.result.SafeGasPrice) * gweiUnit;
                } else if(process.env.GASPRICELEVEL == "high") {
                    gasPrice = parseInt(info.result.FastGasPrice) * gweiUnit;
                }
            } else if (gasMode == "0"||(gasMode == "1" && info.status === "0")){
                console.log(logPrefix + 'using gasPrice value from the .env:');
                gasPrice = parseInt(process.env.TGASPRICE);
            }
            console.log('gasPrice = ' + gasPrice + ` (${gasPrice / gweiUnit}) GWEI`)
            console.log('gasLimit = ' + process.env.TGASLIMIT)

            const registeredOraclesPublicKeys = await this.fioContract.methods.getOracles().call();
            if(registeredOraclesPublicKeys.includes(process.env.ETH_ORACLE_PUBLIC)) {
                var transactionCount = 0;
                try {
                    const oraclePublicKey = process.env.ETH_ORACLE_PUBLIC;
                    const oraclePrivateKey = process.env.ETH_ORACLE_PRIVATE;

                    // todo: check if we should make further actions in case of already approved transaction (do not forget await)
                    this.fioContract.methods.getApproval(txIdOnFioChain).call()
                        .then((response) => {
                            console.log(logPrefix + 'Oracles Approvals:');
                            console.log(response);
                        });
                    if(this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "ETH") { //check validation if the address is ERC20 address
                        console.log(logPrefix + `requesting wrap action of ${quantity} FIO tokens to ${wrapData.public_address}`)
                        const wrapFunc = this.fioContract.methods.wrap(wrapData.public_address, quantity, txIdOnFioChain);
                        let wrapABI = wrapFunc.encodeABI();
                        var nonce = await this.web3.eth.getTransactionCount(oraclePublicKey);//calculate noce value for transaction
                        const ethTransaction = new Tx(
                            {
                                gasPrice: this.web3.utils.toHex(gasPrice),
                                gasLimit: this.web3.utils.toHex(parseInt(process.env.TGASLIMIT)),
                                to: process.env.FIO_TOKEN_ETH_CONTRACT,
                                data: wrapABI,
                                from: oraclePublicKey,
                                nonce: this.web3.utils.toHex(nonce),
                                // nonce: web3.utils.toHex(0)
                            },
                            { chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' }
                        );

                        addLogMessage({
                            filePath: ethereumChainLogPath,
                            message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens submit' + ' {gasPrice: ' + gasPrice + ', gasLimit: ' + process.env.TGASLIMIT + ', amount: ' + quantity + ', to: ' + process.env.FIO_TOKEN_ETH_CONTRACT + ', from: ' + oraclePublicKey + '}',
                        });

                        const privateKey = Buffer.from(oraclePrivateKey, 'hex');
                        ethTransaction.sign(privateKey);
                        const serializedTx = ethTransaction.serialize();
                        await this.web3.eth//excute the sign transaction using public key and private key of oracle
                            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                            .on('transactionHash', (hash) => {
                                console.log(logPrefix + 'transaction has been signed and send into the chain.')
                                console.log('TxHash: ', hash);
                            })
                            .on('receipt', (receipt) => {
                                console.log(logPrefix + "completed");
                                addLogMessage({
                                    filePath: ethereumChainLogPath,
                                    message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens receipt' + ' ' + JSON.stringify(receipt),
                                });
                                transactionCount++;
                            })
                            .on('error', (error, receipt) => {
                                console.log(logPrefix + 'transaction has been failed.') //error message will be logged by catch block

                                if (receipt && receipt.blockHash && !receipt.status) console.log(logPrefix + 'it looks like the transaction ended out of gas.')
                            });

                        if(transactionCount == 0) {
                            const wrapText = txIdOnFioChain + ' ' + JSON.stringify(wrapData) + '\r\n';
                            fs.writeFileSync(tokensWrapTransactionErrLogPath, wrapText); // store issued transaction to log by line-break
                        }
                        let csvContent = fs.readFileSync(tokensWrapTransactionLogPath).toString().split('\r\n'); // read file and convert to array by line break
                        csvContent.shift(); // remove the first element from array
                        var newTxId;
                        var newData;
                        if (csvContent.length > 0 && csvContent[0] != '') { //check if the queue is empty
                            newTxId = csvContent[0].split(' ')[0];
                            newData = JSON.parse(csvContent[0].split(' ')[1]);
                            this.wrapFioToken(newTxId, newData); //execute next transaction from transaction log
                            csvContent = csvContent.join('\r\n'); // convert array back to string
                            fs.writeFileSync(tokensWrapTransactionLogPath, csvContent)
                        } else {
                            fs.writeFileSync(tokensWrapTransactionLogPath, "")
                            return 0;
                        }
                        console.log(logPrefix + `requesting wrap action of ${quantity} FIO tokens to ${wrapData.public_address}: successfully completed`)
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    console.log(logPrefix + error.stack);
                    addLogMessage({
                        filePath: ethereumChainLogPath,
                        message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens' + ' ' + error,
                    });
                }
            }
        } catch (err) {
            handleServerError(err, 'ETH, wrapFioToken');
        }
    }

    async wrapDomainFunction(tx_id, wrapData) {// excute wrap action
        try {
            const info = await (await fetch(process.env.ETH_API_URL)).json();
            const gasMode = process.env.USEGASAPI;
            var gasPrice = 0;
            if ((gasMode == "1" && info.status === "1")||(gasMode == "0" && parseInt(process.env.TGASPRICE) <= 0)) {
                if (process.env.GASPRICELEVEL == "average") {
                    gasPrice = parseInt(info.result.ProposeGasPrice) * 1000000000;
                } else if(process.env.GASPRICELEVEL == "low") {
                    gasPrice = parseInt(info.result.SafeGasPrice) * 1000000000;
                } else if(process.env.GASPRICELEVEL == "high") {
                    gasPrice = parseInt(info.result.FastGasPrice) * 1000000000;
                }
            } else if (gasMode == "0"||(gasMode == "1" && info.status === "0")){
                gasPrice = parseInt(process.env.TGASPRICE);
            }
            this.fioNftContract.methods.getApproval(tx_id).call();
            var transactionCount = 0;
            try {
                const pubKey = process.env.ETH_ORACLE_PUBLIC;
                const signKey = process.env.ETH_ORACLE_PRIVATE;
                this.fioNftContract.methods.getApproval(tx_id).call()
                    .then((response) => {
                        console.log(response);
                    });
                if(this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "ETH") { //check validation if the address is ERC20 address
                    const wrapFunc = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, tx_id);
                    let wrapABI = wrapFunc.encodeABI();
                    var nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate noce value for transaction
                    const tx = new Tx(
                        {
                            gasPrice: this.web3.utils.toHex(gasPrice),
                            gasLimit: this.web3.utils.toHex(parseInt(process.env.TGASLIMIT)),
                            to: process.env.FIO_NFT_ETH_CONTRACT,
                            data: wrapABI,
                            from: pubKey,
                            nonce: this.web3.utils.toHex(nonce),
                            // nonce: web3.utils.toHex(0)
                        },
                        // todo: this should refactored when using ETH chain for FIO Domain (NFT) wrapping
                        { chain: 'rinkeby', hardfork: 'istanbul' }
                    );
                    const privateKey = Buffer.from(signKey, 'hex');
                    tx.sign(privateKey);
                    const serializedTx = tx.serialize();
                    await this.web3.eth//excute the sign transaction using public key and private key of oracle
                        .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                        .on('transactionHash', (hash) => {
                            console.log(wrapData.public_address+" : "+pubKey);
                            console.log('TxHash: ', hash);
                        })
                        .on('receipt', (receipt) => {
                            console.log("completed");
                            addLogMessage({
                                filePath: ethereumChainLogPath,
                                message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt),
                            });
                            transactionCount++;
                        })
                    if(transactionCount == 0) {
                        const timeStamp = new Date().toISOString();
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapData) + '\r\n';
                        fs.writeFileSync(domainWrapTransactionErrorLogPath, wrapText); // store issued transaction to log by line-break
                    }
                    let csvContent = fs.readFileSync(domainWrapTransactionLogPath).toString().split('\r\n'); // read file and convert to array by line break
                    csvContent.shift(); // remove the first element from array
                    var newTxId;
                    var newData;
                    if (csvContent.length > 0 && csvContent[0] != '') { //check if the queue is empty
                        newTxId = csvContent[0].split(' ')[0];
                        newData = JSON.parse(csvContent[0].split(' ')[1]);
                        this.wrapDomainFunction(newTxId, newData);//excuete next transaction from transaction log
                        csvContent = csvContent.join('\r\n'); // convert array back to string
                        fs.writeFileSync(domainWrapTransactionLogPath, csvContent)
                    } else {
                        fs.writeFileSync(domainWrapTransactionLogPath, "")
                        return 0;
                    }

                } else {
                    console.log("Invalid Address");
                }
            } catch (error) {
                console.log(error);
                addLogMessage({
                    filePath: ethereumChainLogPath,
                    message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'wrapdomian' + ' ' + error,
                });
            }
        } catch (err) {
            handleServerError(err, 'ETH, wrapDomainFunction');
        }
    }

}

export default new EthCtrl();
