import 'dotenv/config';
import Web3 from 'web3';
import fs from 'fs';

import config from '../../config/config.js';
import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };

import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { ACTION_NAMES, CONTRACT_NAMES, ETH_CHAIN_NAME, ETH_TOKEN_CODE } from '../constants/chain.js';
import { DEFAULT_ETH_GAS_PRICE, ETH_GAS_LIMIT } from '../constants/prices.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import {
  handleEthChainCommon,
  isOracleEthAddressValid,
  convertNativeFioIntoFio,
} from '../utils/chain.js';
import {
  addLogMessage,
  updateEthNonce,
  handleChainError,
  handleLogFailedWrapItem,
  handleEthNonceValue,
  handleUpdatePendingPolygonItemsQueue,
  handleServerError,
} from '../utils/log-files.js';
import { getEthGasPriceSuggestion } from '../utils/prices.js';
import { polygonTransaction } from '../utils/transactions.js';

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

        const logPrefix = `${ETH_CHAIN_NAME}, ${ACTION_NAMES.WRAP_TOKENS}, FIO tx_id: "${txIdOnFioChain}", amount: ${convertNativeFioIntoFio(wrapData.amount)} FIO, public_address: "${wrapData.public_address}": --> `
        console.log(`${logPrefix} Executing ${ACTION_NAMES.WRAP_TOKENS}.`);

        try {
            const isOracleAddressValid = await isOracleEthAddressValid();

            if (!isOracleAddressValid) {
                console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
                config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
            } else {
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

                    if (this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === ETH_TOKEN_CODE) { //check validation if the address is ERC20 address
                        console.log(`${logPrefix} preparing wrap action.`)
                        const wrapFunction = this.fioContract.methods.wrap(wrapData.public_address, wrapData.amount, txIdOnFioChain)

                        let wrapABI = wrapFunction.encodeABI();

                        const chainNonce =
                          await this.web3.eth.getTransactionCount(
                            oraclePublicKey,
                            'pending'
                          );
                        const txNonce = handleEthNonceValue({ chainNonce });

                        const common = handleEthChainCommon();

                        const onSussessTransaction = (receipt) => {
                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: `${ETH_CHAIN_NAME} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} receipt ${JSON.stringify(receipt)}`,
                            });

                            isTransactionProceededSuccessfully = true;
                        };
                        
                        await polygonTransaction({
                          amount: wrapData.amount,
                          actionName: ACTION_NAMES.WRAP_TOKENS,
                          chainName: ETH_CHAIN_NAME,
                          common,
                          contract: process.env.FIO_TOKEN_ETH_CONTRACT,
                          contractName: CONTRACT_NAMES.ERC_20,
                          data: wrapABI,
                          defaultGasPrice: DEFAULT_ETH_GAS_PRICE,
                          getGasPriceSuggestionFn: getEthGasPriceSuggestion,
                          gasLimit: ETH_GAS_LIMIT,
                          handleSuccessedResult: onSussessTransaction,
                          logFilePath: LOG_FILES_PATH_NAMES.ETH,
                          logPrefix,
                          oraclePrivateKey,
                          oraclePublicKey,
                          shouldThrowError: true,
                          tokenCode: ETH_TOKEN_CODE,
                          txNonce,
                          updateNonce: updateEthNonce,
                          web3Instance: this.web3,
                        });
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: `${ETH_CHAIN_NAME} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} ${error}`,
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

                handleUpdatePendingPolygonItemsQueue({
                    action: this.handleWrap.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting
                })
            }
        } catch (err) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
            handleServerError(err, `${ETH_CHAIN_NAME}, ${ACTION_NAMES.WRAP_TOKENS}`);
        }
    }
}

export default new EthCtrl();
