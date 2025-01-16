import 'dotenv/config';
import fs from 'fs';

import { isAddress } from 'web3-validator';

import config from '../../config/config.js';

import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  ETH_CHAIN_NAME_CONSTANT,
  ETH_TOKEN_CODE,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { isOracleEthAddressValid, convertNativeFioIntoFio } from '../utils/chain.js';
import {
  addLogMessage,
  handleChainError,
  handleLogFailedWrapItem,
  handleUpdatePendingItemsQueue,
  handleServerError,
} from '../utils/log-files.js';
import { blockChainTransaction } from '../utils/transactions.js';

const { oracleCache } = config;

class EthCtrl {
  async handleWrap() {
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionQueue)
      .toString()
      .split('\r\n')[0];
    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      return;
    }

    const wrapOracleId = transactionToProceed.split(' ')[0];
    const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);
    const { amount, chaincode, pubaddress } = wrapData || {};

    const logPrefix = `${ETH_CHAIN_NAME_CONSTANT}, ${ACTION_NAMES.WRAP_TOKENS}, FIO oracle id: "${wrapOracleId}", amount: ${convertNativeFioIntoFio(amount)} FIO, pubaddress: "${pubaddress}": -->`;
    console.log(`${logPrefix} Executing ${ACTION_NAMES.WRAP_TOKENS}.`);

    try {
      const isOracleAddressValid = await isOracleEthAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          if (isAddress(pubaddress) === true && chaincode === ETH_TOKEN_CODE) {
            //check validation if the address is ERC20 address
            console.log(`${logPrefix} preparing wrap action.`);

            const onSussessTransaction = (receipt) => {
              addLogMessage({
                filePath: LOG_FILES_PATH_NAMES.ETH,
                message: `${ETH_CHAIN_NAME_CONSTANT} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} receipt ${receipt}`,
              });

              isTransactionProceededSuccessfully = true;
            };

            await blockChainTransaction({
              action: ACTION_NAMES.WRAP_TOKENS,
              chainName: ETH_CHAIN_NAME_CONSTANT,
              contractActionParams: {
                amount,
                obtId: wrapOracleId,
                pubaddress,
              },
              logPrefix,
              shouldThrowError: true,
              handleSuccessedResult: onSussessTransaction,
            });
          } else {
            console.log(`${logPrefix} Invalid Address`);
          }
        } catch (error) {
          handleChainError({
            logMessage: `${ETH_CHAIN_NAME_CONSTANT} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} ${error}`,
            consoleMessage: `${logPrefix} ${error.stack}`,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue,
            txId: wrapOracleId,
            wrapData,
          });
        }

        handleUpdatePendingItemsQueue({
          action: this.handleWrap.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting,
        });
      }
    } catch (err) {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      handleServerError(err, `${ETH_CHAIN_NAME_CONSTANT}, ${ACTION_NAMES.WRAP_TOKENS}`);
    }
  }
}

export default new EthCtrl();
