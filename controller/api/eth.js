import 'dotenv/config';
import { Common } from '@ethereumjs/common'
import Web3 from 'web3';
import fs from 'fs';

import config from '../../config/config.js';
import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import {
    addLogMessage,
    calculateAverageGasPrice,
    calculateHighGasPrice,
    convertGweiToWei,
    convertNativeFioIntoFio,
    convertWeiToEth,
    convertWeiToGwei,
    getEthGasPriceSuggestion,
    handleChainError,
    handleLogFailedWrapItem,
    handleEthNonceValue,
    handleServerError,
    handleUpdatePendingWrapItemsQueue,
    isOracleEthAddressValid,
    polygonTransaction,
    updateEthNonce,
} from '../helpers.js';
import { LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS } from '../constants.js';

class EthCtrl {
    constructor() {
        this.web3 = new Web3(process.env.ETHINFURA);
        this.fioContract = new this.web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, process.env.FIO_NFT_ETH_CONTRACT);
    }

    // It handles both wrap actions (domain and tokens) on ETH chain, this is designed to prevent nonce collisions,
    // when asynchronous jobs make transactions with same nonce value from one address (oracle public address),
    // so it causes "replacing already existing transaction in the chain".
    async handleWrap() {
        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting))
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

        const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionQueue).toString().split('\r\n')[0];
        if (transactionToProceed === '') {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
            return;
        }

        const txIdOnFioChain = transactionToProceed.split(' ')[0];
        const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);

        const logPrefix = `ETH, handleWrap, FIO tx_id: "${txIdOnFioChain}", amount: ${convertNativeFioIntoFio(wrapData.amount)} FIO, public_address: "${wrapData.public_address}": --> `
        console.log(logPrefix + 'Executing handleWrap.');

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

            console.log(logPrefix + `gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI), gasLimit = ${gasLimit}`)

            // we shouldn't await it to do not block the rest of the actions flow
            this.web3.eth.getBalance(process.env.ETH_ORACLE_PUBLIC, 'latest', (error, oracleBalance) => {
                if (error) {
                    console.log(logPrefix + 'getBalance: ' + error.stack)
                } else {
                    if (convertWeiToEth(oracleBalance) < ((convertWeiToEth(gasLimit * gasPrice)) * 5)) {
                        const timeStamp = new Date().toISOString();
                        console.log(logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.oracleErrors, timeStamp + ' ' + logPrefix + `Warning: Low Oracle ETH Address Balance: ${convertWeiToEth(oracleBalance)} ETH`)
                    }
                }
            })

            const isOracleAddressValid = await isOracleEthAddressValid();

            if (isOracleAddressValid) {
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
                        console.log(logPrefix + `preparing wrap action.`)
                        const wrapFunction = this.fioContract.methods.wrap(wrapData.public_address, wrapData.amount, txIdOnFioChain)

                        let wrapABI = wrapFunction.encodeABI();

                        const chainNonce =
                          await this.web3.eth.getTransactionCount(
                            oraclePublicKey,
                            'pending'
                          );
                        const txNonce = handleEthNonceValue({ chainNonce });

                        const common = new Common({ chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' })

                        const submitLogData = {
                            amount: wrapData.amount,
                            gasPrice,
                            gasLimit,
                            to: process.env.FIO_TOKEN_ETH_CONTRACT,
                            from: oraclePublicKey,
                            txNonce,
                        }

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.ETH,
                            message: `ETH fio.erc20 wraptokens submit ${JSON.stringify(submitLogData)}`,
                        });

                        const onSussessTransaction = (receipt) => {
                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: `ETH fio.erc20 wraptokens receipt ${JSON.stringify(receipt)}`,
                            });

                            isTransactionProceededSuccessfully = true;
                        };
                        
                        await polygonTransaction({
                          common,
                          contract: process.env.FIO_TOKEN_ETH_CONTRACT,
                          gasPrice,
                          gasLimit,
                          handleSuccessedResult: onSussessTransaction,
                          logPrefix,
                          oraclePrivateKey,
                          oraclePublicKey,
                          shouldThrowError: true,
                          txNonce,
                          updateNonce: updateEthNonce,
                          web3Instanstce: this.web3,
                          wrapABI,
                        });
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: `ETH fio.erc20 wraptokens ${error}`,
                        consoleMessage: logPrefix + error.stack
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedWrapItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue,
                        txId: txIdOnFioChain,
                        wrapData
                    })
                }

                handleUpdatePendingWrapItemsQueue({
                    action: this.handleWrap.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting
                })
            } else {
                console.log(logPrefix + 'Oracle data is not valid, pls check .env and contract abi.');
                config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
            }
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
            handleServerError(err, 'ETH, handleWrap');
        }
    }
}

export default new EthCtrl();
