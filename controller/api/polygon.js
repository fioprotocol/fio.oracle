import 'dotenv/config';
import fs from 'fs';

import { isAddress } from 'web3-validator';

import config from '../../config/config.js';

import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
  MATIC_TOKEN_CODE,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { TRANSACTION_DELAY } from '../constants/transactions.js';
import { isOraclePolygonAddressValid } from '../utils/chain.js';
import { sleep } from '../utils/general.js';
import {
  addLogMessage,
  handleLogFailedWrapItem,
  handleLogFailedBurnNFTItem,
  handleUpdatePendingItemsQueue,
  handleServerError,
  handleChainError,
} from '../utils/log-files.js';

import { blockChainTransaction } from '../utils/transactions.js';

const { oracleCache } = config || {};

class PolyCtrl {
  constructor() {
    this.contractName = CONTRACT_NAMES.ERC_721;
  }

  async wrapFioDomain() {
    // execute wrap action
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue)
      .toString()
      .split('\r\n')[0];

    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      return;
    }

    const wrapOracleId = transactionToProceed.split(' ')[0];
    const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);
    const { chaincode, nftname, pubaddress } = wrapData || {};

    const actionName = ACTION_NAMES.WRAP_DOMAIN;

    const logPrefix = `${POLYGON_TOKEN_CODE}, ${actionName}, FIO oracle id: ${wrapOracleId}, nftname: "${nftname}", pubaddress: "${pubaddress}": -->`;
    console.log(`${logPrefix} Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          if (
            isAddress(pubaddress) === true &&
            (chaincode === MATIC_TOKEN_CODE || chaincode === POLYGON_TOKEN_CODE)
          ) {
            //check validation if the address is ERC20 address

            console.log(
              `${logPrefix} requesting wrap domain action for ${nftname} FIO domain to ${pubaddress}`,
            );

            const onSussessTransaction = (receipt) => {
              addLogMessage({
                filePath: LOG_FILES_PATH_NAMES.POLYGON,
                message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${receipt}`,
                addTimestamp: false,
              });

              isTransactionProceededSuccessfully = true;
            };

            await blockChainTransaction({
              action: actionName,
              chainName: POLYGON_CHAIN_NAME,
              contractActionParams: {
                domain: nftname,
                obtId: wrapOracleId,
                pubaddress,
              },
              handleSuccessedResult: onSussessTransaction,
              logPrefix,
              shouldThrowError: true,
            });
          } else {
            console.log(`${logPrefix} Invalid Address`);
          }
        } catch (error) {
          handleChainError({
            logMessage: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${error}`,
            consoleMessage: `${logPrefix} ${error.stack}`,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
            txId: wrapOracleId,
            wrapData,
          });
        }

        handleUpdatePendingItemsQueue({
          action: this.wrapFioDomain.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting,
        });
      }
    } catch (err) {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);

      handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`);
    }
  }

  async burnNFTOnPolygon() {
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue)
      .toString()
      .split('\r\n')[0];
    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
      return;
    }

    const burnNFTData = JSON.parse(transactionToProceed);

    const { tokenId, obtId, domainName } = burnNFTData || {};
    const actionName = ACTION_NAMES.BURN_NFT;

    const logPrefix = `${POLYGON_CHAIN_NAME}, ${actionName}, FIO obtId: ${obtId}, domain: ${domainName}, tokenId: ${tokenId}: -->`;
    console.log(`${logPrefix} Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          // Need to set timeout to handle a big amount of burn calls to blockchain
          await sleep(TRANSACTION_DELAY);

          const onSussessTransaction = (receipt) => {
            addLogMessage({
              filePath: LOG_FILES_PATH_NAMES.POLYGON,
              message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${receipt}`,
            });

            isTransactionProceededSuccessfully = true;
          };

          await blockChainTransaction({
            action: actionName,
            chainName: POLYGON_CHAIN_NAME,
            contractActionParams: {
              tokenId,
              obtId,
            },
            handleSuccessedResult: onSussessTransaction,
            logPrefix,
            shouldThrowError: true,
          });
        } catch (error) {
          handleChainError({
            logMessage: `BURN ERROR ${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${error}`,
            consoleMessage: `${logPrefix} ${error.stack}`,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedBurnNFTItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions,
            burnData: JSON.stringify(burnNFTData),
          });
        }

        handleUpdatePendingItemsQueue({
          action: this.burnNFTOnPolygon.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting,
        });
      }
    } catch (error) {
      console.error(error);
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);

      handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`);
    }
  }
}

export default new PolyCtrl();
