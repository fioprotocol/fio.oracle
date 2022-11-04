require('dotenv').config();
import Web3 from "web3";
const fs = require('fs');
import { Transaction } from "@ethereumjs/tx";
import { Common, CustomChain } from '@ethereumjs/common';
import config from "../../config/config";
import fioNftABI from "../../config/ABI/FIOMATICNFT.json";
import {
    addLogMessage, calculateAverageGasPrice, calculateHighGasPrice,
    convertGweiToWei,
    convertWeiToEth,
    convertWeiToGwei, getPolygonGasPriceSuggestion,
    handleChainError, handleLogFailedWrapItem,
    handleServerError, handleUpdatePendingWrapItemsQueue, isOraclePolygonAddressValid
} from "../helpers";


import {LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS} from "../constants";

class PolyCtrl {
    constructor() {
        this.web3 = new Web3(process.env.POLYGON_INFURA);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT_POLYGON_CONTRACT);
    }
    async wrapFioDomain() { // execute wrap action
        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting))
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, true, 0);

        const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue).toString().split('\r\n')[0];
        if (transactionToProceed === '') {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
            return;
        }

        const txIdOnFioChain = transactionToProceed.split(' ')[0];
        const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);

        const logPrefix = `MATIC, wrapFioDomain, FIO tx_id: ${txIdOnFioChain}, domain: "${wrapData.fio_domain}", public_address: "${wrapData.public_address}": --> `
        console.log(logPrefix + 'Executing wrapFioDomain.');

        try {
            const domainName = wrapData.fio_domain;
            const common = Common.custom(process.env.MODE === 'testnet' ? CustomChain.PolygonMumbai : CustomChain.PolygonMainnet)

            const gasPriceSuggestion = await getPolygonGasPriceSuggestion();

            const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
            let gasPrice = 0;
            if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.PGASPRICE) <= 0)) {
                console.log(logPrefix + 'using gasPrice value from the api:');
                if (process.env.GASPRICELEVEL === "average") {
                    gasPrice = calculateAverageGasPrice(gasPriceSuggestion);
                } else if(process.env.GASPRICELEVEL === "low") {
                    gasPrice = gasPriceSuggestion;
                } else if(process.env.GASPRICELEVEL === "high") {
                    gasPrice = calculateHighGasPrice(gasPriceSuggestion);
                }
            } else if (!isUsingGasApi || (isUsingGasApi && gasPriceSuggestion)){
                console.log(logPrefix + 'using gasPrice value from the .env:');
                gasPrice = convertGweiToWei(process.env.PGASPRICE);
            }

            if (!gasPrice) throw new Error(logPrefix + 'Cannot set valid Gas Price value');

            const gasLimit = parseFloat(process.env.PGASLIMIT);

            console.log(logPrefix + `gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI), gasLimit = ${gasLimit}`)

            // we shouldn't await it to do not block the rest of the actions
            this.web3.eth.getBalance(process.env.POLYGON_ORACLE_PUBLIC, 'latest', (error, oracleBalance) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    if (convertWeiToEth(oracleBalance) < ((convertWeiToEth(gasLimit * gasPrice)) * 5)) {
                        const timeStamp = new Date().toISOString();
                        console.log(logPrefix + `Warning: Low Oracle Polygon Address Balance: ${convertWeiToEth(oracleBalance)} MATIC`)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.oracleErrors, timeStamp + ' ' + logPrefix + `Warning: Low Oracle Polygon Address Balance: ${convertWeiToEth(oracleBalance)} MATIC`)
                    }
                }
            })

            const isOracleAddressValid = await isOraclePolygonAddressValid();

            if (isOracleAddressValid) {
                let isTransactionProceededSuccessfully = false;
                try {
                    const pubKey = process.env.POLYGON_ORACLE_PUBLIC;
                    const signKey = process.env.POLYGON_ORACLE_PRIVATE;

                    //Commented this out. It was throwing an uncaught exception.
                    // todo: check if we should make wrap call (maybe just jump to read logs file) in case of already approved transaction by current oracle (do not forget to await)
                    //this.fioNftContract.methods.getApproval(txIdOnFioChain).call()
                    //    .then((response) => {
                    //        console.log(logPrefix + 'Oracles Approvals:');
                    //        console.log(response);
                    //    });

                    if (this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "MATIC") { //check validation if the address is ERC20 address
                        console.log(logPrefix + `requesting wrap domain action for ${domainName} FIO domain to ${wrapData.public_address}`)
                        const wrapDomainFunction = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, txIdOnFioChain);
                        let wrapABI = wrapDomainFunction.encodeABI();
                        const nonce = await this.web3.eth.getTransactionCount(pubKey, 'pending');//calculate nonce value for transaction
                        const polygonTransaction = Transaction.fromTxData(
                            {
                                gasPrice: this.web3.utils.toHex(gasPrice),
                                gasLimit: this.web3.utils.toHex(gasLimit),
                                to: config.FIO_NFT_POLYGON_CONTRACT,
                                data: wrapABI,
                                from: pubKey,
                                nonce: this.web3.utils.toHex(nonce),
                            },
                            { common }
                        );

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.MATIC,
                            message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain submit' + ' {gasPrice: ' + gasPrice + ', gasLimit: ' + gasLimit + ', domain: ' + wrapData.fio_domain + ', to: ' + process.env.FIO_NFT_POLYGON_CONTRACT + ', from: ' + pubKey + ', nonce: ' + nonce + '}',
                        });

                        const privateKey = Buffer.from(signKey, 'hex');
                        const serializedTx = polygonTransaction.sign(privateKey).serialize().toString('hex');
                        try {
                            await this.web3.eth //excute the sign transaction using public key and private key of oracle
                                .sendSignedTransaction('0x' + serializedTx)
                                .on('transactionHash', (hash) => {
                                    console.log(logPrefix + `transaction has been signed and send into the chain. TxHash: ${hash}, nonce: ${nonce}`);
                                })
                                .on('receipt', (receipt) => {
                                    console.log(logPrefix + "transaction has been successfully completed in the chain.");
                                    addLogMessage({
                                        filePath: LOG_FILES_PATH_NAMES.MATIC,
                                        message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt),
                                    });
                                    isTransactionProceededSuccessfully = true;
                                })
                                .on('error', (error, receipt) => {
                                    console.log(logPrefix + 'transaction has been failed in the chain.') //error message will be logged by catch block

                                    if (receipt && receipt.blockHash && !receipt.status) console.log(logPrefix + 'It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value.')
                                });
                        } catch(e) {
                            console.log(logPrefix + e.stack);
                        }
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomian' + ' ' + error,
                        consoleMessage: logPrefix + error.stack
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedWrapItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
                        txId: txIdOnFioChain,
                        wrapData
                    })
                }

                handleUpdatePendingWrapItemsQueue({
                    action: this.wrapFioDomain.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting
                })
            } else config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);

            handleServerError(err, 'Polygon, wrapFioDomain')
        }
    }
}

export default new PolyCtrl();
