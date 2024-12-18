import 'dotenv/config';

import fs from 'fs';

import Web3 from 'web3';

import ethCtrl from './eth.js';
import moralis from './moralis.js';
import polygonCtrl from './polygon.js';
import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioPolygonABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import config from '../../config/config.js';

import {
  CONTRACT_NAMES,
  ETH_CHAIN_NAME_CONSTANT,
  ETH_TOKEN_CODE,
  FIO_ACCOUNT_NAMES,
  FIO_CHAIN_NAME,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
  FIO_TABLE_NAMES,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';

import { convertNativeFioIntoFio } from '../utils/chain.js';
import {
  getLastIrreversibleBlockOnFioChain,
  getOracleItems,
  getFioDeltasV2,
  runUnwrapFioTransaction,
} from '../utils/fio-chain.js';
import { sleep, convertTimestampIntoMs, formatDateYYYYMMDD } from '../utils/general.js';
import {
  addLogMessage,
  updateBlockNumberFIOForBurnNFT,
  updateBlockNumberForTokensUnwrappingOnETH,
  updateBlockNumberForDomainsUnwrappingOnETH,
  updateBlockNumberMATIC,
  getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping,
  getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping,
  getLastProceededBlockNumberOnFioChainForBurnNFT,
  getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping,
  getLastProcessedFioOracleItemId,
  updateFioOracleId,
  handleLogFailedWrapItem,
  handleUpdatePendingPolygonItemsQueue,
  handleServerError,
  handleChainError,
} from '../utils/log-files.js';
import MathOp from '../utils/math.js';

const {
  eth: { BLOCKS_RANGE_LIMIT_ETH, BLOCKS_OFFSET_ETH, ETH_CONTRACT, ETH_NFT_CONTRACT },
  fio: { FIO_TRANSACTION_MAX_RETRIES, FIO_HISTORY_HYPERION_OFFSET, LOWEST_ORACLE_ID },
  infura: { eth, polygon },
  nfts: { NFT_CHAIN_NAME },
  oracleCache,
  polygon: { BLOCKS_RANGE_LIMIT_POLY, POLYGON_CONTRACT },
} = config;

const web3 = new Web3(eth);
const polyWeb3 = new Web3(polygon);
const fioTokenContractOnEthChain = new web3.eth.Contract(fioABI, ETH_CONTRACT);
const fioNftContract = new web3.eth.Contract(fioNftABI, ETH_NFT_CONTRACT);
const fioPolygonNftContract = new polyWeb3.eth.Contract(fioPolygonABI, POLYGON_CONTRACT);

// execute unwrap action job
const handleUnwrapFromEthToFioChainJob = async () => {
  if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting))
    oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

  const transactionToProceed = fs
    .readFileSync(LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue)
    .toString()
    .split('\r\n')[0];
  if (transactionToProceed === '') {
    oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting, false, 0);
    return;
  }

  const txIdOnEthChain = transactionToProceed.split(' ')[0];
  const unwrapData = JSON.parse(transactionToProceed.split(' ')[1]);

  const isUnwrappingTokens = !!parseInt(unwrapData.amount || '');
  const fioAddress = unwrapData.fioaddress;
  let isTransactionProceededSuccessfully = false;

  const logPrefix = `FIO, unwrapFromEthToFioChainJob, ETH tx_id: "${txIdOnEthChain}", ${isUnwrappingTokens ? `amount: ${convertNativeFioIntoFio(unwrapData.amount)} wFIO` : `domain: "${unwrapData.domain}"`}, fioAddress :  "${fioAddress}": -->`;
  console.log(`${logPrefix} Start`);

  let retries = 0;

  while (retries < FIO_TRANSACTION_MAX_RETRIES && !isTransactionProceededSuccessfully) {
    try {
      const actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain',
        amount = parseInt(unwrapData.amount);

      const transactionActionData = {
        fio_address: fioAddress,
        obt_id: txIdOnEthChain,
      };

      if (isUnwrappingTokens) {
        transactionActionData.amount = amount;
      } else transactionActionData.domain = unwrapData.domain;

      const transactionResult = await runUnwrapFioTransaction({
        actionName,
        transactionActionData,
      });

      if (!(transactionResult.type || transactionResult.error)) {
        isTransactionProceededSuccessfully = true;
        console.log(`${logPrefix} Completed:`);
      } else {
        retries++;
        console.log(`${logPrefix} Error:`);
        console.log(`${logPrefix} Retry increment to ${retries}`);
      }

      console.log(JSON.stringify(transactionResult, null, 4));

      addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.FIO,
        message: {
          chain: 'FIO',
          contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
          action: actionName,
          transaction: transactionResult,
        },
      });
    } catch (err) {
      retries++;
      await sleep(SECOND_IN_MILLISECONDS);
      handleServerError(err, 'FIO, handleUnwrapFromEthToFioChainJob');
    }
  }

  console.log(isTransactionProceededSuccessfully);
  if (!isTransactionProceededSuccessfully) {
    handleLogFailedWrapItem({
      logPrefix,
      errorLogFilePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionErrorQueue,
      txId: txIdOnEthChain,
      wrapData: unwrapData,
    });
  }

  handleUpdatePendingPolygonItemsQueue({
    action: handleUnwrapFromEthToFioChainJob,
    logPrefix,
    logFilePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting,
  });
};

const handleUnwrapFromPolygonToFioChainJob = async () => {
  if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting))
    oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

  const transactionToProceed = fs
    .readFileSync(LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue)
    .toString()
    .split('\r\n')[0];
  if (transactionToProceed === '') {
    oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting, false, 0);
    return;
  }

  const txIdOnPolygonChain = transactionToProceed.split(' ')[0];
  const unwrapData = JSON.parse(transactionToProceed.split(' ')[1]);

  const fioAddress = unwrapData.fioaddress;
  let isTransactionProceededSuccessfully = false;

  const logPrefix = `FIO, unwrapFromPolygonToFioChainJob, Polygon tx_id: "${txIdOnPolygonChain}", domain: "${unwrapData.domain}", fioAddress :  "${fioAddress}": -->`;
  console.log(`${logPrefix} Start`);

  let retries = 0;

  while (retries < FIO_TRANSACTION_MAX_RETRIES && !isTransactionProceededSuccessfully) {
    try {
      const transactionActionData = {
        fio_address: fioAddress,
        fio_domain: unwrapData.domain,
        obt_id: txIdOnPolygonChain,
      };

      const transactionResult = await runUnwrapFioTransaction({
        actionName: 'unwrapdomain',
        transactionActionData,
      });

      if (!(transactionResult.type || transactionResult.error)) {
        isTransactionProceededSuccessfully = true;
        console.log(`${logPrefix} Completed:`);
      } else {
        console.log(`${logPrefix} Error:`);
        retries++;
        console.log(`${logPrefix} Error:`);
        console.log(`${logPrefix} Retry increment to ${retries}`);
      }

      console.log(JSON.stringify(transactionResult, null, 4));

      addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.FIO,
        message: {
          chain: 'FIO',
          contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
          action: 'unwrapdomain Polygon',
          transaction: transactionResult,
        },
      });
    } catch (err) {
      retries++;
      await sleep(SECOND_IN_MILLISECONDS);
      handleServerError(err, 'FIO, handleUnwrapFromPolygonToFioChainJob');
    }
  }

  if (!isTransactionProceededSuccessfully) {
    handleLogFailedWrapItem({
      logPrefix,
      errorLogFilePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionErrorQueue,
      txId: txIdOnPolygonChain,
      wrapData: unwrapData,
    });
  }

  handleUpdatePendingPolygonItemsQueue({
    action: handleUnwrapFromPolygonToFioChainJob,
    logPrefix,
    logFilePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting,
  });
};

class FIOCtrl {
  constructor() {}

  async handleUnprocessedWrapActionsOnFioChain() {
    const logPrefix =
      'FIO, Get latest Wrap (tokens and domains) actions on FIO chain -->';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, true, 0);
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    const handleWrapAction = async () => {
      const lastProcessedFioOracleItemId =
        getLastProcessedFioOracleItemId() || LOWEST_ORACLE_ID;

      console.log(`${logPrefix} start oracle from id = ${lastProcessedFioOracleItemId}`);

      const oracleItems = await getOracleItems({
        logPrefix,
        lowerBound: lastProcessedFioOracleItemId,
      });

      const irreversibleBlockTimeInTimestamp = Date.now() - 181 * SECOND_IN_MILLISECONDS; // irreversibility of block number takes 180 seconds. Take 181 second to be sure it has been submitted.

      const irreversibleOracleItems = oracleItems.filter(({ timestamp }) => {
        const timestampMs = convertTimestampIntoMs(timestamp);

        return timestampMs < irreversibleBlockTimeInTimestamp;
      });

      if (!irreversibleOracleItems || !irreversibleOracleItems.length) {
        console.log(`${logPrefix} No items to wrap`);

        return;
      }

      console.log(`${logPrefix} process items count: ${irreversibleOracleItems.length}`);

      for (const irreversibleOracleItem of irreversibleOracleItems) {
        const { amount, chaincode, id, nftname, pubaddress } = irreversibleOracleItem;

        if (!nftname && !amount) {
          console.log('No data to process');
          return;
        }

        let action, wrapQueueFile;

        const transactionData = {
          chaincode,
          id,
          pubaddress,
        };

        if (nftname) {
          action = 'wrapdomain POL';
          wrapQueueFile = LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue;
          transactionData.nftname = nftname;
        } else if (amount) {
          action = 'wraptokens';
          wrapQueueFile = LOG_FILES_PATH_NAMES.wrapEthTransactionQueue;
          transactionData.amount = amount;
        }

        const existingFIOLogs = fs
          .readFileSync(LOG_FILES_PATH_NAMES.FIO, 'utf-8')
          .toString();

        const isEventDataExists = existingFIOLogs.includes(`"id":${id}`);

        if (!isEventDataExists) {
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
              chain: FIO_CHAIN_NAME,
              contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
              action,
              transaction: transactionData,
            },
          });

          // save tx data into wrap queue log files
          addLogMessage({
            filePath: wrapQueueFile,
            message: `${id} ${JSON.stringify(transactionData)}`,
            addTimestamp: false,
          });
        }
      }

      updateFioOracleId((irreversibleOracleItems[0].id + 1).toString());

      const isWrapOnEthJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting,
      );
      const isWrapOnPolygonJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting,
      );
      console.log(`${logPrefix} isWrapOnEthJobExecuting: ${!!isWrapOnEthJobExecuting}`);
      console.log(
        `${logPrefix} isWrapOnPolygonJobExecuting: ${!!isWrapOnPolygonJobExecuting}`,
      );

      // start wrap job on Eth if it's not running
      if (!isWrapOnEthJobExecuting) {
        ethCtrl.handleWrap(); // execute first wrap action, it will trigger further wrap actions from the log file recursively
      }
      // start wrap job on Polygon job if it's not running
      if (!isWrapOnPolygonJobExecuting) {
        polygonCtrl.wrapFioDomain(); // execute first wrap action, it will trigger further wrap actions from the log file recursively
      }
    };

    try {
      await handleWrapAction();
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedWrapActionsOnFioChain');
    }
    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, false, 0);
    console.log(`${logPrefix} End`);
  }

  async handleUnprocessedUnwrapActionsOnEthChainActions() {
    const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnEthChainActions -->`;

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting)) {
      oracleCache.set(
        ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting,
        true,
        0,
      ); // ttl = 0 means that value shouldn't ever been expired
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    try {
      const blocksRangeLimit = parseInt(BLOCKS_RANGE_LIMIT_ETH);
      const blocksOffset = parseInt(BLOCKS_OFFSET_ETH) || 0;

      const getEthActionsLogs = async (from, to, isTokens = false) => {
        return await (
          isTokens ? fioTokenContractOnEthChain : fioNftContract
        ).getPastEvents(
          'unwrapped',
          {
            fromBlock: from,
            toBlock: to,
          },
          async (error, events) => {
            if (!error) {
              return events;
            } else {
              // also this error will be caught in the catch block
              console.log(
                `${logPrefix} Unwrap ${isTokens ? 'Tokens' : 'Domain'}, requesting past unwrap events, Blocks Numbers from ${from} to ${to} ${ETH_CHAIN_NAME_CONSTANT} Error:`,
              );

              handleChainError({
                logMessage:
                  `${ETH_CHAIN_NAME_CONSTANT} ${isTokens ? `${CONTRACT_NAMES.ERC_20} unwraptokens` : `${CONTRACT_NAMES.ERC_721} unwrapdomains`} getPastEvents ` +
                  error,
                consoleMessage: error,
              });
            }
          },
        );
      };

      const getUnprocessedActionsLogs = async (isTokens = false) => {
        const chainBlockNumber = await web3.eth.getBlockNumber();
        const lastInChainBlockNumber = new MathOp(chainBlockNumber)
          .sub(blocksOffset)
          .toNumber();
        const lastProcessedBlockNumber = isTokens
          ? getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping()
          : getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping();

        if (new MathOp(lastProcessedBlockNumber).gt(lastInChainBlockNumber))
          throw new Error(
            `${logPrefix} Unwrap ${isTokens ? 'Tokens' : 'Domain'}, Wrong start blockNumber, pls check stored value.`,
          );

        let fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

        console.log(
          `${logPrefix} Unwrap ${isTokens ? 'Tokens' : 'Domain'}, start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`,
        );

        let result = [];
        let maxCheckedBlockNumber = 0;

        while (new MathOp(fromBlockNumber).lte(lastInChainBlockNumber)) {
          const maxAllowedBlockNumber = new MathOp(fromBlockNumber)
            .add(blocksRangeLimit)
            .sub(1)
            .toNumber();

          const toBlockNumber = new MathOp(maxAllowedBlockNumber).gt(
            lastInChainBlockNumber,
          )
            ? lastInChainBlockNumber
            : maxAllowedBlockNumber;

          maxCheckedBlockNumber = toBlockNumber;
          if (isTokens) {
            updateBlockNumberForTokensUnwrappingOnETH(maxCheckedBlockNumber.toString());
          } else
            updateBlockNumberForDomainsUnwrappingOnETH(maxCheckedBlockNumber.toString());

          result = [
            ...result,
            ...(await getEthActionsLogs(fromBlockNumber, toBlockNumber, isTokens)),
          ];

          fromBlockNumber = new MathOp(toBlockNumber).add(1).toNumber();
        }

        console.log(
          `${logPrefix} Unwrap ${isTokens ? 'Tokens' : 'Domain'} events list length: ${result.length}`,
        );
        return result;
      };

      const unwrapTokensData = await getUnprocessedActionsLogs(true);
      const unwrapDomainsData = await getUnprocessedActionsLogs();

      if (unwrapTokensData.length > 0) {
        unwrapTokensData.forEach((item) => {
          const logText = `${item.transactionHash} ${JSON.stringify(item.returnValues)}`;

          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.ETH,
            message: `${ETH_TOKEN_CODE} ${CONTRACT_NAMES.ERC_20} unwraptokens ${JSON.stringify(item)}`,
          });

          // save tx data into unwrap tokens and domains queue log file
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
            message: logText,
            addTimestamp: false,
          });
        });
      }
      if (unwrapDomainsData.length > 0) {
        unwrapDomainsData.forEach((item) => {
          const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.ETH,
            message: `${ETH_CHAIN_NAME_CONSTANT} ${CONTRACT_NAMES.ERC_721} unwrapdomains ${JSON.stringify(item)}`,
          });

          // save tx data into unwrap tokens and domains queue log file
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
            message: logText,
            addTimestamp: false,
          });
        });
      }

      const isUnwrapOnEthJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting,
      );
      console.log(
        `${logPrefix} isUnwrapOnEthJobExecuting: ${!!isUnwrapOnEthJobExecuting}`,
      );

      // start unwrap job on Eth if it's not running
      if (!isUnwrapOnEthJobExecuting) {
        handleUnwrapFromEthToFioChainJob();
      }
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedUnwrapTokensOnEthChainActions');
    }
    oracleCache.set(
      ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting,
      false,
      0,
    );

    console.log(`${logPrefix} all necessary actions were completed successfully`);
  }

  async handleUnprocessedUnwrapActionsOnPolygon() {
    const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnPolygon -->`;

    if (
      !oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting)
    ) {
      oracleCache.set(
        ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting,
        true,
        0,
      ); // ttl = 0 means that value shouldn't ever been expired
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    console.log(`${logPrefix} Executing`);

    try {
      const blocksRangeLimit = parseInt(BLOCKS_RANGE_LIMIT_POLY);

      const getPolygonActionsLogs = async (from, to) => {
        return await fioPolygonNftContract.getPastEvents(
          'unwrapped',
          {
            fromBlock: from,
            toBlock: to,
          },
          async (error, events) => {
            if (!error) {
              return events;
            } else {
              // also this error will be caught in the catch block
              console.log(
                `${logPrefix} requesting past unwrap events, Blocks Numbers from ${from} to ${to} ${POLYGON_CHAIN_NAME} Error:`,
              );

              handleChainError({
                logMessage: `${POLYGON_CHAIN_NAME} ${CONTRACT_NAMES.ERC_721} unwrapdomains getPastEvents ${error}`,
                consoleMessage: error,
              });
            }
          },
        );
      };

      const getUnprocessedActionsLogs = async () => {
        const lastInChainBlockNumber = await polyWeb3.eth.getBlockNumber();
        const lastProcessedBlockNumber =
          getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping();

        if (new MathOp(lastProcessedBlockNumber).gt(lastInChainBlockNumber))
          throw new Error(
            `${logPrefix} Wrong start blockNumber, pls check stored value.`,
          );

        let fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

        console.log(
          `${logPrefix} start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`,
        );

        const result = [];

        while (new MathOp(fromBlockNumber).lte(lastInChainBlockNumber)) {
          const maxAllowedBlockNumber = new MathOp(fromBlockNumber)
            .add(blocksRangeLimit)
            .sub(1)
            .toNumber();

          const toBlockNumber = new MathOp(maxAllowedBlockNumber).gt(
            lastInChainBlockNumber,
          )
            ? lastInChainBlockNumber
            : maxAllowedBlockNumber;

          updateBlockNumberMATIC(toBlockNumber.toString());

          const events = await getPolygonActionsLogs(fromBlockNumber, toBlockNumber);

          if (events && events.length) {
            result.push(...events);
          }

          fromBlockNumber = new MathOp(toBlockNumber).add(1).toNumber();
        }

        console.log(`${logPrefix} events list length: ${result.length}`);
        return result;
      };

      const data = await getUnprocessedActionsLogs();

      if (data.length > 0) {
        data.forEach((item) => {
          const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.POLYGON,
            message: `${POLYGON_CHAIN_NAME} ${CONTRACT_NAMES.ERC_721} unwrapdomains ${JSON.stringify(item)}`,
          });

          // save tx data into unwrap tokens and domains queue log file
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
            message: logText,
            addTimestamp: false,
          });
        });
      }

      const isUnwrapOnPolygonJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting,
      );
      console.log(
        `${logPrefix} isUnwrapOnEthJobExecuting: ${!!isUnwrapOnPolygonJobExecuting}`,
      );

      // start unwrap job on Polygon if it's not running
      if (!isUnwrapOnPolygonJobExecuting) {
        handleUnwrapFromPolygonToFioChainJob();
      }
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedUnwrapActionsOnPolygon');
    }
    oracleCache.set(
      ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting,
      false,
      0,
    );

    console.log(`${logPrefix} all necessary actions were completed successfully`);
  }

  async handleUnprocessedBurnNFTActions() {
    const logPrefix = 'FIO, Get latest Burned domain actions on FIO chain -->';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, true, 0);
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    const handleBurnNFTAction = async () => {
      const lastProcessedFioBlockNumber =
        getLastProceededBlockNumberOnFioChainForBurnNFT() || 0;
      const lastIrreversibleBlock = (await getLastIrreversibleBlockOnFioChain()) || 0;

      console.log(`${logPrefix} start Position = ${lastProcessedFioBlockNumber}`);

      const unprocessedBurnedDomainsList = [];

      const after = lastProcessedFioBlockNumber;
      const before = lastIrreversibleBlock;

      const paramsToPass = {
        code: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
        scope: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
        after,
        before,
        present: 0,
        table: FIO_TABLE_NAMES.FIO_DOMAINS,
        limit: FIO_HISTORY_HYPERION_OFFSET,
        payer: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
      };

      const getFioBurnedDomainsLogsAll = async (params) => {
        const burnedDomainsLogs = await getFioDeltasV2(params);

        if (
          burnedDomainsLogs &&
          burnedDomainsLogs.deltas &&
          burnedDomainsLogs.deltas.length
        ) {
          const deltasLength = burnedDomainsLogs.deltas.length;

          unprocessedBurnedDomainsList.push(
            ...burnedDomainsLogs.deltas
              .filter(
                (deltaItem) => deltaItem.data.account === FIO_ACCOUNT_NAMES.FIO_ORACLE,
              )
              .map((deltaItem) => deltaItem.data.name),
          );

          if (deltasLength) {
            const lastDeltasItem = burnedDomainsLogs.deltas[deltasLength - 1];
            if (lastDeltasItem && lastDeltasItem.block_num) {
              params.before = new MathOp(deltasLength).eq(burnedDomainsLogs.total.value)
                ? lastDeltasItem.block_num - 1
                : lastDeltasItem.block_num;
            }
            // add 1 sec to decrease 429 Too Many requests
            await sleep(SECOND_IN_MILLISECONDS);

            await getFioBurnedDomainsLogsAll(params);
          }
        }
      };

      await getFioBurnedDomainsLogsAll(paramsToPass);

      if (unprocessedBurnedDomainsList.length) {
        console.log(
          `${logPrefix} Burned Domains List From Fio Length: ${unprocessedBurnedDomainsList.length}`,
        );

        const nftsListToBurn = [];

        console.log('START GETTING MORALIS NFTS');

        const nftsList = await moralis.getAllContractNFTs({
          chainName: NFT_CHAIN_NAME,
          contract: POLYGON_CONTRACT,
        });

        console.log(`NFTS LENGTH ${nftsList && nftsList.length}`);

        for (const nftItem of nftsList) {
          const { metadata, token_id, normalized_metadata } = nftItem;

          let metadataName = null;

          if (normalized_metadata && normalized_metadata.name) {
            metadataName = normalized_metadata.name;
          } else if (metadata) {
            try {
              const parsedMetadata = JSON.parse(metadata);
              if (parsedMetadata && parsedMetadata.name) {
                metadataName = parsedMetadata.name;
              }
            } catch (error) {
              console.error(`${logPrefix} Failed to parse metadata: ${error}`);
            }
          }

          const name = metadataName && metadataName.split(': ')[1];

          if (name) {
            const existingDomainInBurnList = unprocessedBurnedDomainsList.find(
              (burnedDomain) => name === burnedDomain,
            );

            if (existingDomainInBurnList) {
              const trxId = `AutomaticDomainBurn${formatDateYYYYMMDD(new Date())}${name}`;

              nftsListToBurn.push({
                tokenId: token_id,
                obtId: trxId,
                domainName: name,
              });

              const existingFIOLogs = fs
                .readFileSync(LOG_FILES_PATH_NAMES.FIO, 'utf-8')
                .toString();

              const isActionDataExists = existingFIOLogs.includes(trxId);

              if (!isActionDataExists) {
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.FIO,
                  message: {
                    chain: FIO_CHAIN_NAME,
                    contract: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
                    action: `burnDomain ${POLYGON_TOKEN_CODE}`,
                    transaction: { trxId, domainName: name },
                  },
                });
              }
            }
          }
        }

        console.log(`Nfts List To Burn: length = ${nftsListToBurn.length}`);

        for (const nftsListToBurnItem of nftsListToBurn) {
          const existingNFTTransactionsQueue = fs
            .readFileSync(LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue, 'utf-8')
            .toString();

          const isActionDataExists = existingNFTTransactionsQueue.includes(
            nftsListToBurnItem.obtId,
          );

          if (!isActionDataExists) {
            addLogMessage({
              filePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
              message: nftsListToBurnItem,
              addTimestamp: false,
            });
          }
        }
      } else {
        console.log(`${logPrefix} No domains to burn.`);
      }

      console.log(
        `${logPrefix} Update FIO Block Number for burn NFTS: ${lastIrreversibleBlock}`,
      );

      updateBlockNumberFIOForBurnNFT(lastIrreversibleBlock.toString());

      const isBurnNFTOnPolygonJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting,
      );
      console.log(
        `${logPrefix} isBurnNFTOnPolygonJobExecuting: ${!!isBurnNFTOnPolygonJobExecuting}`,
      );

      if (!isBurnNFTOnPolygonJobExecuting) {
        polygonCtrl.burnNFTOnPolygon();
      }
    };

    try {
      await handleBurnNFTAction();
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedBurnNFTActions');
    }

    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, false, 0);
    console.log(`${logPrefix} End`);
  }
}

export default new FIOCtrl();
