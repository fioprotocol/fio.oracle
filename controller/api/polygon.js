require('dotenv').config();
import Web3 from "web3";
import Common from "ethereumjs-common";
import config from "../../config/config";
import fioNftABI from "../../config/ABI/FIOMATICNFT.json";
import {addLogMessage, convertGweiToWei, handleServerError} from "../helpers";
const Tx = require('ethereumjs-tx').Transaction;
const fetch = require('node-fetch');
const fs = require('fs');

import { LOG_FILES_PATH_NAMES } from "../constants";

class PolyCtrl {
    constructor() {
        this.web3 = new Web3(process.env.POLYGON_INFURA);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT_POLYGON_CONTRACT);
    }
    async wrapFioDomain(txIdOnFioChain, wrapData) {// excute wrap action
        const logPrefix = `MATIC, wrapFioDomain, FIO tx_id: ${txIdOnFioChain} --> `
        console.log(logPrefix + 'Executing wrapFioDomain, data to wrap:');
        console.log(wrapData)
        try {
            const info = await (await fetch(process.env.POLYGON_API_URL)).json();
            const gasMode = process.env.USEGASAPI;

            // { chain: process.env.MODE === 'testnet' ? process.env.POLYGON_TESTNET_CHAIN_NAME : 'polygon' }

            const customChainParams = { name: 'matic-mumbai', chainId: 80001, networkId: 80001 }
            const common = Common.forCustomChain('goerli', customChainParams, 'istanbul');
            let gasPrice = 0;
            if ((gasMode === "1" && info.status > 0)||(gasMode === "0" && parseInt(process.env.PGASPRICE) <= 0)) {

                if (process.env.GASPRICELEVEL === "average") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.ProposeGasPrice);
                } else if(process.env.GASPRICELEVEL === "low") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.SafeGasPrice);
                } else if(process.env.GASPRICELEVEL === "high") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.FastGasPrice);
                }
            } else if (gasMode === "0"||(gasMode === "1" && info.status === "0")){
                gasPrice = parseInt(process.env.PGASPRICE);
            }
            this.fioNftContract.methods.getApproval(txIdOnFioChain).call();
            let transactionCount = 0;
            try {
                const pubKey = process.env.POLYGON_ORACLE_PUBLIC;
                const signKey = process.env.POLYGON_ORACLE_PRIVATE;
                this.fioNftContract.methods.getApproval(txIdOnFioChain).call()
                    .then((response) => {
                        console.log(response);
                    });
                if(this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "MATIC") { //check validation if the address is ERC20 address
                    const wrapFunc = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, txIdOnFioChain);
                    let wrapABI = wrapFunc.encodeABI();
                    var nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate nonce value for transaction
                    const tx = new Tx(
                        {
                            gasPrice: this.web3.utils.toHex(gasPrice),
                            gasLimit: this.web3.utils.toHex(parseInt(process.env.PGASLIMIT)),
                            to: config.FIO_NFT_POLYGON_CONTRACT,
                            data: wrapABI,
                            from: pubKey,
                            nonce: this.web3.utils.toHex(nonce),
                            // nonce: web3.utils.toHex(0)
                        },
                        {common}
                    );
                    const privateKey = Buffer.from(signKey, 'hex');
                    tx.sign(privateKey);
                    const serializedTx = tx.serialize();
                    try{
                        await this.web3.eth//excute the sign transaction using public key and private key of oracle
                            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                            .on('transactionHash', (hash) => {
                                console.log(wrapData.public_address+" : "+pubKey);
                                console.log('TxHash: ', hash);
                            })
                            .on('receipt', (receipt) => {
                                console.log("completed");
                                addLogMessage({
                                    filePath: LOG_FILES_PATH_NAMES.MATIC,
                                    message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt),
                                });
                                transactionCount++;
                            })
                    }catch(e) {
                        console.log(e);
                    }

                    if(transactionCount === 0) {
                        const wrapText = txIdOnFioChain + ' ' + JSON.stringify(wrapData) + '\r\n';
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransactionError, wrapText); // store issued transaction to log by line-break
                    }
                    let csvContent = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction).toString().split('\r\n'); // read file and convert to array by line break
                    csvContent.shift(); // remove the first element from array
                    let newTxId;
                    let newData;
                    if (csvContent.length > 0 && csvContent[0] !== '') { //check if the queue is empty
                        newTxId = csvContent[0].split(' ')[0];
                        newData = JSON.parse(csvContent[0].split(' ')[1]);
                        this.wrapFioDomain(newTxId, newData);//excuete next transaction from transaction log
                        csvContent = csvContent.join('\r\n'); // convert array back to string
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction, csvContent)
                    } else {
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction, "")
                        return 0;
                    }

                } else {
                    console.log("Invalid Address");
                }
            } catch (error) {
                addLogMessage({
                    filePath: LOG_FILES_PATH_NAMES.MATIC,
                    message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomian' + ' ' + error,
                });
            }
        } catch (err) {
            handleServerError(err, 'Polygon, wrapDomainFunction')
        }
    }
}

export default new PolyCtrl();
