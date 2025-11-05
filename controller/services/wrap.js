import fs from 'fs';

import { isAddress } from 'web3-validator';

import config from '../../config/config.js';
import { ACTIONS, handleActionName } from '../constants/chain.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { isOracleAddressValid, convertNativeFioIntoFio } from '../utils/chain.js';
import { getOracleCacheKey } from '../utils/cron-jobs.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  addLogMessage,
  handleChainError,
  handleServerError,
  handleUpdatePendingItemsQueue,
  handleLogFailedWrapItem,
} from '../utils/log-files.js';
import { blockChainTransaction } from '../utils/transactions.js';
import { Web3Service } from '../utils/web3-services.js';

const { oracleCache } = config;

export const handleWrap = async ({
  type,
  chainParams,
  infura,
  publicKey,
  contractAddress,
  contractTypeName,
}) => {
  const { chainCode } = chainParams || {};

  const oracleCacheKey = getOracleCacheKey({
    actionName: ACTIONS.WRAP,
    type,
    chainCode,
  });

  if (!oracleCache.get(oracleCacheKey)) {
    oracleCache.set(oracleCacheKey, true, 0); // ttl = 0 means that value shouldn't ever been expired
    console.log(`[handleWrap ${chainCode} ${type}] Started - cache locked`);
  } else {
    console.log(`[handleWrap ${chainCode} ${type}] Already running - skipping`);
    return; // job is already running
  }

  const transactionToProceed = fs
    .readFileSync(getLogFilePath({ key: LOG_FILES_KEYS.WRAP, chainCode, type }))
    .toString()
    .split('\r\n')[0];
  if (transactionToProceed === '') {
    console.log(
      `[handleWrap ${chainCode} ${type}] No transactions in queue - cache released`,
    );
    oracleCache.set(oracleCacheKey, false, 0);
    return;
  }

  const wrapOracleId = transactionToProceed.split(' ')[0];
  const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);
  const { amount, chaincode, nftname, pubaddress } = wrapData || {};

  const actionNameType = handleActionName({
    actionName: ACTIONS.WRAP,
    type,
  });

  const logPrefix = `${chainCode}, ${actionNameType}, FIO oracle id: "${wrapOracleId}", ${amount ? `amount: ${convertNativeFioIntoFio(amount)} FIO` : `nftname: "${nftname}"`}, pubaddress: "${pubaddress}": -->`;
  console.log(`${logPrefix} Executing...`);

  if (chainCode && chaincode && chainCode.toLowerCase() !== chaincode.toLowerCase()) {
    console.log(`${logPrefix} Chain code mismatch - cache released`);
    oracleCache.set(oracleCacheKey, false, 0);
    return;
  }

  try {
    const contract = Web3Service.getWeb3Contract({
      type,
      chainCode,
      contractAddress,
    });

    const isOracleAddressValidResult = await isOracleAddressValid({
      contract,
      publicKey,
    });

    if (!isOracleAddressValidResult) {
      console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS} - cache released`);
      oracleCache.set(oracleCacheKey, false, 0);
    } else {
      let isTransactionProceededSuccessfully = false;

      try {
        if (isAddress(pubaddress) === true) {
          const onSussessTransaction = (receipt) => {
            addLogMessage({
              filePath: getLogFilePath({
                key: LOG_FILES_KEYS.CHAIN,
                chainCode,
                type,
              }),
              message: `${chainCode} ${contractTypeName} ${actionNameType} receipt ${receipt}`,
            });

            isTransactionProceededSuccessfully = true;
          };

          await blockChainTransaction({
            action: actionNameType,
            type,
            chainCode,
            contractActionParams: {
              amount,
              obtId: wrapOracleId,
              pubaddress,
              nftName: nftname,
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
          logMessage: `${chainCode} ${contractTypeName} ${actionNameType} ${error}`,
          consoleMessage: `${logPrefix} ${error.stack}`,
        });
      }

      if (!isTransactionProceededSuccessfully) {
        handleLogFailedWrapItem({
          logPrefix,
          errorLogFilePath: getLogFilePath({
            key: LOG_FILES_KEYS.WRAP_ERROR,
            chainCode,
            type,
          }),
          txId: wrapOracleId,
          wrapData,
        });
      }

      handleUpdatePendingItemsQueue({
        action: () =>
          handleWrap({
            type,
            chainParams,
            infura,
            publicKey,
            contractAddress,
            contractTypeName,
          }),
        logPrefix,
        logFilePath: getLogFilePath({
          key: LOG_FILES_KEYS.WRAP,
          chainCode,
          type,
        }),
        jobIsRunningCacheKey: oracleCacheKey,
      });
    }
  } catch (error) {
    console.log(`[handleWrap ${chainCode} ${type}] Error occurred - cache released`);
    oracleCache.set(oracleCacheKey, false, 0);
    handleServerError(error, actionNameType);
  }
};
