require('dotenv').config();
import { Transaction } from '@ethereumjs/tx'
import Web3 from "web3";
const fetch = require('node-fetch');
const fs = require('fs');
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json";
import {
    addLogMessage, calculateAverageGasPrice, calculateHighGasPrice,
    convertGweiToWei,
    convertNativeFioIntoFio,
    convertWeiToEth,
    convertWeiToGwei, getEthGasPriceSuggestion,
    handleChainError, handleLogFailedWrapItem,
    handleServerError, handleUpdatePendingWrapItemsQueue
} from "../helpers";
import {LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS} from "../constants";

// todo: 'ethereumjs-tx' has been deprecated, update to @ethereumjs/tx
const Tx = require('ethereumjs-tx').Transaction;

const { TextEncoder, TextDecoder } = require('text-encoding');

class EthCtrl {
    constructor() {
        this.web3 = new Web3(process.env.ETHINFURA);
        this.fioContract = new this.web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, process.env.FIO_NFT_ETH_CONTRACT);
    }

    async wrapFioToken(txIdOnFioChain, wrapData) {
        const logPrefix = `ETH, wrapFioToken, FIO tx_id: "${txIdOnFioChain}", amount: ${convertNativeFioIntoFio(wrapData.amount)} FIO --> `
        console.log(logPrefix + 'Executing wrapFioToken, data to wrap:');
        console.log(wrapData)

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapTokensExecuting))
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapTokensExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

        try {
            const quantity = wrapData.amount;
            const gasPriceSuggestion = await getEthGasPriceSuggestion();

            const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
            let gasPrice = 0;
            if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.TGASPRICE) <= 0)) {
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
                gasPrice = convertGweiToWei(process.env.TGASPRICE);
            }

            if (!gasPrice) throw new Error(logPrefix + 'Cannot set valid Gas Price value');

            const gasLimit = parseFloat(process.env.TGASLIMIT);

            console.log('gasPrice = ' + gasPrice + ` (${convertWeiToGwei(gasPrice)} GWEI)`)
            console.log('gasLimit = ' + gasLimit)

            // we shouldn't await it to do not block the rest of the actions flow
            this.web3.eth.getBalance(process.env.ETH_ORACLE_PUBLIC, 'latest', (error, oracleBalance) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    if (convertWeiToEth(oracleBalance) < ((convertWeiToEth(gasLimit * gasPrice)) * 5)) {
                        const timeStamp = new Date().toISOString();
                        console.log(logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.oracleErrors, timeStamp + ' ' + logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                    }
                }
            })

            const registeredOraclesPublicKeys = await this.fioContract.methods.getOracles().call();

            if (registeredOraclesPublicKeys.includes(process.env.ETH_ORACLE_PUBLIC)) {
                let isTransactionProceededSuccessfully = false;

                try {
                    const oraclePublicKey = process.env.ETH_ORACLE_PUBLIC;
                    const oraclePrivateKey = process.env.ETH_ORACLE_PRIVATE;

                    // todo: check if we should make wrap call (maybe just jump to read logs file) in case of already approved transaction by current oracle (do not forget to await)
                    // this.fioContract.methods.getApproval(txIdOnFioChain).call()
                    //     .then((response) => {
                    //         console.log(logPrefix + 'Oracles Approvals:');
                    //         console.log(response);
                    //     }).catch(err => {
                    //         console.log ('Error: ', err);
                    //     });

                    if (this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "ETH") { //check validation if the address is ERC20 address
                        console.log(logPrefix + `requesting wrap action of ${convertNativeFioIntoFio(quantity)} FIO tokens to "${wrapData.public_address}"`)
                        const wrapTokensFunction = this.fioContract.methods.wrap(wrapData.public_address, quantity, txIdOnFioChain);
                        let wrapABI = wrapTokensFunction.encodeABI();
                        const nonce = await this.web3.eth.getTransactionCount(oraclePublicKey, 'pending');
                        //calculate nonce value for transaction
                        console.log(logPrefix + 'nonce number: ' + nonce)

                        const ethTransaction = new Tx(
                            {
                                gasPrice: this.web3.utils.toHex(gasPrice),
                                gasLimit: this.web3.utils.toHex(gasLimit),
                                to: process.env.FIO_TOKEN_ETH_CONTRACT,
                                data: wrapABI,
                                from: oraclePublicKey,
                                nonce: this.web3.utils.toHex(nonce)
                            },
                            { chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' }
                        );

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.ETH,
                            message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens submit' + ' {gasPrice: ' + gasPrice + ', gasLimit: ' + gasLimit + ', amount: ' + quantity + ', to: ' + process.env.FIO_TOKEN_ETH_CONTRACT + ', from: ' + oraclePublicKey + '}',
                        });

                        const privateKey = Buffer.from(oraclePrivateKey, 'hex');
                        ethTransaction.sign(privateKey);
                        const serializedTx = ethTransaction.serialize();
                        await this.web3.eth //excute the sign transaction using public key and private key of oracle
                            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                            .on('transactionHash', (hash) => {
                                console.log(logPrefix + 'transaction has been signed and sent into the chain.')
                                console.log('TxHash: ', hash);
                            })
                            .on('receipt', (receipt) => {
                                console.log(logPrefix + "completed");
                                addLogMessage({
                                    filePath: LOG_FILES_PATH_NAMES.ETH,
                                    message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens receipt' + ' ' + JSON.stringify(receipt),
                                });
                                isTransactionProceededSuccessfully = true;
                            })
                            .on('error', (error, receipt) => {
                                console.log(logPrefix + 'transaction has been failed.') //error message will be logged by catch block

                                if (receipt && receipt.blockHash && !receipt.status) console.log(logPrefix + 'It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value')
                            });

                        if (isTransactionProceededSuccessfully)
                            console.log(logPrefix + `requesting wrap action of ${convertNativeFioIntoFio(quantity)} FIO tokens to ${wrapData.public_address}: Successfully completed`);
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'wraptokens' + ' ' + error,
                        consoleMessage: logPrefix + error.stack
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedWrapItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.wrapTokensTransactionError,
                        txIdOnFioChain,
                        wrapData
                    })
                }

                handleUpdatePendingWrapItemsQueue({
                    action: this.wrapFioToken.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapTokensTransaction,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapTokensExecuting
                })
            } else {
                config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapTokensExecuting, false, 0);
            }
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapTokensExecuting, false, 0);
            handleServerError(err, 'ETH, wrapFioToken');
        }
    }

    async wrapFioDomain(txIdOnFioChain, wrapData) {
        const logPrefix = `ETH, wrapFioDomain, FIO tx_id: "${txIdOnFioChain}", domain: "${wrapData.fio_domain}" --> `
        console.log(logPrefix + 'Executing wrapFioDomain, data to wrap:');
        console.log(wrapData)

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting))
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting, true, 0);

        try {
            const gasPriceSuggestion = await getEthGasPriceSuggestion();

            const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
            let gasPrice = 0;
            if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.TGASPRICE) <= 0)) {
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
                gasPrice = convertGweiToWei(process.env.TGASPRICE);
            }

            if (!gasPrice) throw new Error(logPrefix + 'Cannot set valid Gas Price value');

            const gasLimit = parseFloat(process.env.TGASLIMIT);

            console.log('gasPrice = ' + gasPrice + ` (${convertWeiToGwei(gasPrice)} GWEI)`)
            console.log('gasLimit = ' + gasLimit)

            // we shouldn't await it to do not block the rest of the actions flow
            this.web3.eth.getBalance(process.env.ETH_ORACLE_PUBLIC, 'latest', (error, oracleBalance) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    if (convertWeiToEth(oracleBalance) < ((convertWeiToEth(gasLimit * gasPrice)) * 5)) {
                        const timeStamp = new Date().toISOString();
                        console.log(logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.oracleErrors, timeStamp + ' ' + logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                    }
                }
            })

            const registeredOraclesPublicKeys = await this.fioContract.methods.getOracles().call();
            if (registeredOraclesPublicKeys.includes(process.env.ETH_ORACLE_PUBLIC)) {
                let isTransactionProceededSuccessfully = false;
                try {
                    const oraclePublicKey = process.env.ETH_ORACLE_PUBLIC;
                    const oraclePrivateKey = process.env.ETH_ORACLE_PRIVATE;

                    if (this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "ETH") { //check validation if the address is ERC721 address
                        console.log(logPrefix + `requesting wrap action of domain: "${wrapData.fio_domain}", to "${wrapData.public_address}"`)
                        const wrapDomainFunction = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, txIdOnFioChain);
                        let wrapABI = wrapDomainFunction.encodeABI();
                        const nonce = await this.web3.eth.getTransactionCount(oraclePublicKey, 'pending'); //calculate nonce value for transaction
                        console.log(logPrefix + 'nonce number: ' + nonce)

                        const ethTransaction = new Tx(
                            {
                                gasPrice: this.web3.utils.toHex(gasPrice),
                                gasLimit: this.web3.utils.toHex(gasLimit),
                                to: process.env.FIO_NFT_ETH_CONTRACT,
                                data: wrapABI,
                                from: oraclePublicKey,
                                nonce: this.web3.utils.toHex(nonce)
                            },
                            { chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' }
                        );

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.ETH,
                            message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain submit' + ' {gasPrice: ' + gasPrice + ', gasLimit: ' + gasLimit + ', domain: ' + wrapData.fio_domain + ', to: ' + process.env.FIO_NFT_ETH_CONTRACT + ', from: ' + oraclePublicKey + '}',
                        });

                        const privateKey = Buffer.from(oraclePrivateKey, 'hex');
                        ethTransaction.sign(privateKey);
                        const serializedTx = ethTransaction.serialize();

                        await this.web3.eth //excute the sign transaction using public key and private key of oracle
                            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                            .on('transactionHash', (hash) => {
                                console.log(logPrefix + 'transaction has been signed and sent into the chain.')
                                console.log('TxHash: ', hash);
                            })
                            .on('receipt', (receipt) => {
                                console.log(logPrefix + "completed");
                                addLogMessage({
                                    filePath: LOG_FILES_PATH_NAMES.ETH,
                                    message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt),
                                });
                                isTransactionProceededSuccessfully = true;
                            })
                            .on('error', (error, receipt) => {
                                console.log(logPrefix + 'transaction has been failed.') //error message will be logged by catch block

                                if (receipt && receipt.blockHash && !receipt.status) console.log(logPrefix + 'It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value')
                            });

                        if (isTransactionProceededSuccessfully) console.log(logPrefix + `Successfully completed.`)
                    } else {
                        console.log(logPrefix + `Invalid Address`);
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: 'ETH' +' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + error,
                        consoleMessage: logPrefix + error.stack
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedWrapItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.wrapDomainByEthTransactionError,
                        txIdOnFioChain,
                        wrapData
                    })
                }

                handleUpdatePendingWrapItemsQueue({
                    action: this.wrapFioDomain.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapDomainByEthTransaction,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting
                })
            } else {
                config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting, false, 0);
            }
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting, false, 0);
            handleServerError(err, 'ETH, wrapFioDomain');
        }
    }

}

export default new EthCtrl();
