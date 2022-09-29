require('dotenv').config();
import Web3 from "web3";
import Common, { CustomChain } from '@ethereumjs/common';
import config from "../../config/config";
import fioNftABI from "../../config/ABI/FIOMATICNFT.json";
import {addLogMessage, convertGweiToWei, convertWeiToEth, convertWeiToGwei, handleServerError} from "../helpers";
const Tx = require('ethereumjs-tx').Transaction;
const fetch = require('node-fetch');
const fs = require('fs');

import {LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS} from "../constants";

class PolyCtrl {
    constructor() {
        this.web3 = new Web3(process.env.POLYGON_INFURA);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT_POLYGON_CONTRACT);
    }
    async wrapFioDomain(txIdOnFioChain, wrapData) { // excute wrap action
        const logPrefix = `MATIC, wrapFioDomain, FIO tx_id: ${txIdOnFioChain}, domain: ${wrapData.fio_domain} --> `
        console.log(logPrefix + 'Executing wrapFioDomain, data to wrap:');
        console.log(wrapData)

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting))
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting, true, 0);

        try {
            const domainName = wrapData.fio_domain;
            const gasPriceSuggestions = await (await fetch(process.env.POLYGON_API_URL)).json();
            const gasMode = process.env.USEGASAPI;

            const common = Common.custom(process.env.MODE === 'testnet' ? CustomChain.PolygonMumbai : CustomChain.PolygonMainnet)

            let gasPrice = 0;
            if ((gasMode === "1" && gasPriceSuggestions.status > 0) || (gasMode === "0" && parseInt(process.env.PGASPRICE) <= 0)) {
                console.log(logPrefix + 'using gasPrice value from the api:');
                if (process.env.GASPRICELEVEL === "average") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.ProposeGasPrice);
                } else if(process.env.GASPRICELEVEL === "low") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.SafeGasPrice);
                } else if(process.env.GASPRICELEVEL === "high") {
                    gasPrice = convertGweiToWei(gasPriceSuggestions.result.FastGasPrice);
                }
            } else if (gasMode === "0" || (gasMode === "1" && gasPriceSuggestions.status === "0")) {
                console.log(logPrefix + 'using gasPrice value from the .env:');
                gasPrice = convertGweiToWei(process.env.PGASPRICE);
            }

            if (!gasPrice) throw new Error(logPrefix + 'Cannot set valid Gas Price value');

            const gasLimit = parseFloat(process.env.PGASLIMIT);

            console.log('gasPrice = ' + gasPrice + ` (${convertWeiToGwei(gasPrice)} GWEI)`)
            console.log('gasLimit = ' + gasLimit)

            
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
                    const nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate nonce value for transaction
                    const polygonTransaction = new Tx(
                        {
                            gasPrice: this.web3.utils.toHex(gasPrice),
                            gasLimit: this.web3.utils.toHex(gasLimit),
                            to: config.FIO_NFT_POLYGON_CONTRACT,
                            data: wrapABI,
                            from: pubKey,
                            nonce: this.web3.utils.toHex(nonce),
                        },
                        {common}
                    );
                    const privateKey = Buffer.from(signKey, 'hex');
                    polygonTransaction.sign(privateKey);
                    const serializedTx = polygonTransaction.serialize();
                    try{
                        await this.web3.eth//excute the sign transaction using public key and private key of oracle
                            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                            .on('transactionHash', (hash) => {
                                console.log(logPrefix + 'transaction has been signed and send into the chain.')
                                console.log('TxHash: ', hash);
                            })
                            .on('receipt', (receipt) => {
                                console.log(logPrefix + "completed");
                                addLogMessage({
                                    filePath: LOG_FILES_PATH_NAMES.MATIC,
                                    message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt),
                                });
                                isTransactionProceededSuccessfully = true;
                            })
                            .on('error', (error, receipt) => {
                                console.log(logPrefix + 'transaction has been failed.') //error message will be logged by catch block

                                if (receipt && receipt.blockHash && !receipt.status) console.log(logPrefix + 'It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value.')
                            });
                    } catch(e) {
                        console.log(logPrefix + e.stack);
                    }

                    if (!isTransactionProceededSuccessfully) {
                        console.log(logPrefix + `something went wrong, storing transaction data into ${LOG_FILES_PATH_NAMES.wrapDomainTransactionError}`)
                        const wrapText = txIdOnFioChain + ' ' + JSON.stringify(wrapData) + '\r\n';
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransactionError, wrapText); // store issued transaction to log by line-break
                    }
                    let csvContent = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction).toString().split('\r\n'); // read file and convert to array by line break
                    csvContent.shift(); // remove the first element from array
                    let nextFioWrapDomainTransactionIdToProceed;
                    let newData;
                    if (csvContent.length > 0 && csvContent[0] !== '') { //check if the queue is empty
                        nextFioWrapDomainTransactionIdToProceed = csvContent[0].split(' ')[0];
                        newData = JSON.parse(csvContent[0].split(' ')[1]);
                        console.log(logPrefix + `preparing to execute next wrap domain transaction from ${LOG_FILES_PATH_NAMES.wrapDomainTransaction} log file for FIO tx_id: ${nextFioWrapDomainTransactionIdToProceed}`)
                        this.wrapFioDomain(nextFioWrapDomainTransactionIdToProceed, newData); //excuete next transaction from transaction log
                        csvContent = csvContent.join('\r\n'); // convert array back to string
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction, csvContent)
                        console.log(logPrefix + `${LOG_FILES_PATH_NAMES.wrapDomainTransaction} log file was successfully updated.`)
                    } else {
                        config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting, false, 0);

                        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapDomainTransaction, "")
                        console.log(logPrefix + `requesting wrap domain action for ${domainName} FIO domain to ${wrapData.public_address}: successfully completed`)
                        return 0;
                    }
                    console.log(logPrefix + `requesting wrap domain action for ${domainName} FIO domain to ${wrapData.public_address}: successfully completed`)
                } else {
                    config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting, false, 0);

                    console.log(logPrefix + "Invalid Address");
                }
            } catch (error) {
                config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting, false, 0);

                console.log(logPrefix + error.stack);
                addLogMessage({
                    filePath: LOG_FILES_PATH_NAMES.MATIC,
                    message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomian' + ' ' + error,
                });
            }
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting, false, 0);

            handleServerError(err, 'Polygon, wrapDomainFunction')
        }
    }
}

export default new PolyCtrl();
