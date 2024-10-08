import 'dotenv/config';

import fs from 'fs';

import { Fio } from '@fioprotocol/fiojs';
import fetch from 'node-fetch';
import * as textEncoderObj from 'text-encoding';
import Web3 from 'web3';

import ethCtrl from './eth.js';
import moralis from './moralis.js';
import polygonCtrl from './polygon.js';
import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioPolygonABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import config from '../../config/config.js';

import { FIO_ACCOUNT_NAMES } from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';

import { convertNativeFioIntoFio } from '../utils/chain.js';
import {
  getUnprocessedActionsOnFioChain,
  getLastIrreversibleBlockOnFioChain,
} from '../utils/fio-chain.js';
import { handleBackups, sleep } from '../utils/general.js';
import {
  addLogMessage,
  updateBlockNumberFIO,
  updateBlockNumberFIOForBurnNFT,
  updateBlockNumberForTokensUnwrappingOnETH,
  updateBlockNumberForDomainsUnwrappingOnETH,
  updateBlockNumberMATIC,
  updatefioOraclePositionFIO,
  getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping,
  getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping,
  getLastProceededBlockNumberOnFioChain,
  getLastProceededFioOraclePositionFioChain,
  getLastProceededFioAddressPositionFioChain,
  getLastProceededBlockNumberOnFioChainForBurnNFT,
  getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping,
  handleLogFailedWrapItem,
  handleUpdatePendingPolygonItemsQueue,
  handleServerError,
  handleChainError,
  updatefioAddressPositionFIO,
} from '../utils/log-files.js';
import MathOp from '../utils/math.js';

const defaultTextEncoderObj = textEncoderObj.default || {};

const TextDecoder = defaultTextEncoderObj.TextDecoder;
const TextEncoder = defaultTextEncoderObj.TextEncoder;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const {
  eth: { BLOCKS_RANGE_LIMIT_ETH, BLOCKS_OFFSET_ETH, ETH_CONTRACT, ETH_NFT_CONTRACT },
  fio: {
    FIO_ORACLE_PERMISSION,
    FIO_SERVER_HISTORY_VERSION,
    FIO_TRANSACTION_MAX_RETRIES,
    FIO_SERVER_URL_ACTION,
    FIO_SERVER_HISTORY_VERSION_BACKUP,
    FIO_ORACLE_PRIVATE_KEY,
    FIO_ORACLE_ACCOUNT,
    FIO_HISTORY_OFFSET,
    FIO_HISTORY_HYPERION_OFFSET,
  },
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

  const logPrefix = `FIO, unwrapFromEthToFioChainJob, ETH tx_id: "${txIdOnEthChain}", ${isUnwrappingTokens ? `amount: ${convertNativeFioIntoFio(unwrapData.amount)} wFIO` : `domain: "${unwrapData.domain}"`}, fioAddress :  "${fioAddress}": --> `;
  console.log(logPrefix + 'Start');

  let retries = 0;

  while (retries < FIO_TRANSACTION_MAX_RETRIES && !isTransactionProceededSuccessfully) {
    try {
      const contract = FIO_ACCOUNT_NAMES.FIO_ORACLE,
        actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain', //action name
        oraclePrivateKey = FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = FIO_ORACLE_ACCOUNT,
        amount = parseInt(unwrapData.amount),
        obtId = txIdOnEthChain,
        domain = unwrapData.domain;
      const fioChainInfo = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_info')
      ).json();
      const fioLastBlockInfo = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_block', {
          body: `{"block_num_or_id": ${fioChainInfo.last_irreversible_block_num}}`,
          method: 'POST',
        })
      ).json();

      const chainId = fioChainInfo.chain_id;
      const currentDate = new Date();
      const timePlusTen = currentDate.getTime() + 10000;
      const timeInISOString = new Date(timePlusTen).toISOString();
      const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

      const transactionActionsData = {
        fio_address: fioAddress,
        obt_id: obtId,
        actor: oracleAccount,
      };

      if (isUnwrappingTokens) {
        transactionActionsData.amount = amount;
      } else transactionActionsData.domain = domain;

      const transaction = {
        expiration,
        ref_block_num: fioLastBlockInfo.block_num & 0xffff,
        ref_block_prefix: fioLastBlockInfo.ref_block_prefix,
        actions: [
          {
            account: contract,
            name: actionName,
            authorization: [
              {
                actor: oracleAccount,
                permission: FIO_ORACLE_PERMISSION,
              },
            ],
            data: transactionActionsData,
          },
        ],
      };
      const abiMap = new Map();
      const tokenRawAbi = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_raw_abi', {
          body: `{"account_name": ${FIO_ACCOUNT_NAMES.FIO_ORACLE}}`,
          method: 'POST',
        })
      ).json();
      abiMap.set(FIO_ACCOUNT_NAMES.FIO_ORACLE, tokenRawAbi);

      const privateKeys = [oraclePrivateKey];

      const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder,
        textEncoder,
      });

      const pushResult = await fetch(
        FIO_SERVER_URL_ACTION + 'v1/chain/push_transaction',
        {
          //execute transaction for unwrap
          body: JSON.stringify(tx),
          method: 'POST',
        },
      );
      const transactionResult = await pushResult.json();

      if (!(transactionResult.type || transactionResult.error)) {
        isTransactionProceededSuccessfully = true;
        console.log(logPrefix + `Completed:`);
      } else {
        retries++;
        console.log(logPrefix + `Error:`);
        console.log(`${logPrefix} Retry increment to ${retries}`);
      }

      console.log(JSON.stringify(transactionResult, null, 4));

      addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.FIO,
        message: {
          chain: 'FIO',
          contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
          action: isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomains',
          transaction: transactionResult,
        },
      });
    } catch (err) {
      retries++;
      await sleep(1000);
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

  const logPrefix = `FIO, unwrapFromPolygonToFioChainJob, Polygon tx_id: "${txIdOnPolygonChain}", domain: "${unwrapData.domain}", fioAddress :  "${fioAddress}": --> `;
  console.log(logPrefix + 'Start');

  let retries = 0;

  while (retries < FIO_TRANSACTION_MAX_RETRIES && !isTransactionProceededSuccessfully) {
    try {
      const contract = FIO_ACCOUNT_NAMES.FIO_ORACLE,
        action = 'unwrapdomain', //action name
        oraclePrivateKey = FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = FIO_ORACLE_ACCOUNT,
        domain = unwrapData.domain,
        obtId = txIdOnPolygonChain;
      const info = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_info')
      ).json();
      const blockInfo = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_block', {
          body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`,
          method: 'POST',
        })
      ).json();
      const chainId = info.chain_id;
      const currentDate = new Date();
      const timePlusTen = currentDate.getTime() + 10000;
      const timeInISOString = new Date(timePlusTen).toISOString();
      const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

      const transaction = {
        expiration,
        ref_block_num: blockInfo.block_num & 0xffff,
        ref_block_prefix: blockInfo.ref_block_prefix,
        actions: [
          {
            account: contract,
            name: action,
            authorization: [
              {
                actor: oracleAccount,
                permission: FIO_ORACLE_PERMISSION,
              },
            ],
            data: {
              fio_address: fioAddress,
              fio_domain: domain,
              obt_id: obtId,
              actor: oracleAccount,
            },
          },
        ],
      };
      const abiMap = new Map();
      const tokenRawAbi = await (
        await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_raw_abi', {
          body: `{"account_name": ${FIO_ACCOUNT_NAMES.FIO_ORACLE}}`,
          method: 'POST',
        })
      ).json();
      abiMap.set(FIO_ACCOUNT_NAMES.FIO_ORACLE, tokenRawAbi);

      const privateKeys = [oraclePrivateKey];

      const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder,
        textEncoder,
      });

      const pushResult = await fetch(
        FIO_SERVER_URL_ACTION + 'v1/chain/push_transaction',
        {
          //excute transaction for unwrap
          body: JSON.stringify(tx),
          method: 'POST',
        },
      );

      const transactionResult = await pushResult.json();

      if (!(transactionResult.type || transactionResult.error)) {
        isTransactionProceededSuccessfully = true;
        console.log(logPrefix + `Completed:`);
      } else {
        console.log(logPrefix + `Error:`);
        retries++;
        console.log(logPrefix + `Error:`);
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
      await sleep(1000);
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
      'FIO, Get latest Wrap (tokens and domains) actions on FIO chain --> ';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, true, 0);
    } else {
      console.log(logPrefix + 'Job is already running');
      return;
    }

    const handleWrapAction = async ({ fioServerHistoryVersion }) => {
      const isV2 = fioServerHistoryVersion === 'hyperion';

      const offset = isV2
        ? parseInt(FIO_HISTORY_HYPERION_OFFSET)
        : parseInt(FIO_HISTORY_OFFSET);

      const lastFioOraclePosition = getLastProceededFioOraclePositionFioChain() || 0;
      const lastProcessedFioBlockNumber = getLastProceededBlockNumberOnFioChain() || 0;
      const lastIrreversibleBlock = (await getLastIrreversibleBlockOnFioChain()) || 0;

      console.log(
        logPrefix +
          `start Position = ${isV2 ? lastProcessedFioBlockNumber : lastFioOraclePosition}`,
      );

      let nextPos = lastFioOraclePosition;
      let nextBefore = lastIrreversibleBlock;

      let hasMoreActions = true;

      while (hasMoreActions) {
        const actionsLogsResult = await getUnprocessedActionsOnFioChain({
          accountName: FIO_ACCOUNT_NAMES.FIO_ORACLE,
          fioServerHistoryVersion,
          pos: nextPos,
          offset,
          before: nextBefore,
          after: lastProcessedFioBlockNumber,
        });

        const actionsToProcess =
          actionsLogsResult &&
          actionsLogsResult.actions &&
          actionsLogsResult.actions.length > 0
            ? actionsLogsResult.actions.filter((actionItem) =>
                new MathOp(actionItem.block_num).lte(lastIrreversibleBlock),
              )
            : [];

        const wrapActionsToProcess = actionsToProcess.filter(
          (actionsToProcessItem) =>
            (actionsToProcessItem.action_trace.act.name === 'wraptokens' ||
              actionsToProcessItem.action_trace.act.name === 'wrapdomain') &&
            (actionsToProcessItem.action_trace.act.data.chain_code === 'MATIC' ||
              actionsToProcessItem.action_trace.act.data.chain_code === 'POL' ||
              actionsToProcessItem.action_trace.act.data.chain_code === 'ETH'),
        );

        const actionsToProcessLength = wrapActionsToProcess
          ? wrapActionsToProcess.length
          : 0;

        console.log(logPrefix + `wrap events data length : ${actionsToProcessLength}`);

        if (actionsToProcessLength > 0) {
          const processedWrapDataArray = [];
          for (const eventData of wrapActionsToProcess) {
            if (
              (eventData.action_trace.act.name === 'wraptokens' ||
                eventData.action_trace.act.name === 'wrapdomain') &&
              eventData.action_trace.act.data.chain_code === 'ETH'
            ) {
              const isWrappingTokens = eventData.action_trace.act.name === 'wraptokens';
              const tx_id = eventData.action_trace.trx_id;
              const wrapText =
                tx_id + ' ' + JSON.stringify(eventData.action_trace.act.data);
              if (processedWrapDataArray.includes(tx_id)) {
                return;
              } else {
                processedWrapDataArray.push(tx_id);
              }

              const existingFIOLogs = fs
                .readFileSync(LOG_FILES_PATH_NAMES.FIO, 'utf-8')
                .toString();

              const isEventDataExists = existingFIOLogs.includes(tx_id);

              // save tx data into wrap tokens and domains queue log file
              if (!isEventDataExists) {
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.FIO,
                  message: {
                    chain: 'FIO',
                    contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
                    action: isWrappingTokens ? 'wraptokens' : 'wrapdomain ETH',
                    transaction: eventData,
                  },
                });
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
                  message: wrapText,
                  addTimestamp: false,
                });
              }
            } else if (
              eventData.action_trace.act.name === 'wrapdomain' &&
              (eventData.action_trace.act.data.chain_code === 'MATIC' ||
                eventData.action_trace.act.data.chain_code === 'POL')
            ) {
              const tx_id = eventData.action_trace.trx_id;
              const wrapText =
                tx_id + ' ' + JSON.stringify(eventData.action_trace.act.data);
              if (processedWrapDataArray.includes(tx_id)) {
                return;
              } else {
                processedWrapDataArray.push(tx_id);
              }

              const existingFIOLogs = fs
                .readFileSync(LOG_FILES_PATH_NAMES.FIO, 'utf-8')
                .toString();

              const isEventDataExists = existingFIOLogs.includes(tx_id);

              if (!isEventDataExists) {
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.FIO,
                  message: {
                    chain: 'FIO',
                    contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
                    action: 'wrapdomain MATIC',
                    transaction: eventData,
                  },
                });
                // save tx data into wrap domain on Polygon queue log file
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
                  message: wrapText,
                  addTimestamp: false,
                });
              }
            }
          }

          const lastAction = actionsToProcess[actionsToProcess.length - 1];

          nextPos = new MathOp(nextPos).add(actionsToProcess.length).toString();

          nextBefore = lastAction ? lastAction.block_num - 1 : nextBefore;
        } else {
          hasMoreActions = false;
          if (actionsToProcess && actionsToProcess.length > 0) {
            nextPos = new MathOp(nextPos).add(actionsToProcess.length).toString();
          }
        }

        if (!isV2) {
          console.log(`${logPrefix}update FIO Oracle position to ${nextPos}`);
          updatefioOraclePositionFIO(nextPos.toString());
        }
      }

      const isWrapOnEthJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting,
      );
      const isWrapOnPolygonJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting,
      );
      console.log(logPrefix + 'isWrapOnEthJobExecuting: ' + !!isWrapOnEthJobExecuting);
      console.log(
        logPrefix + 'isWrapOnPolygonJobExecuting: ' + !!isWrapOnPolygonJobExecuting,
      );

      if (isV2) {
        console.log(
          `${logPrefix}update FIO Oracle Block Number to ${lastIrreversibleBlock}`,
        );
        updateBlockNumberFIO(lastIrreversibleBlock.toString());
      }

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
      await handleBackups(handleWrapAction, false, {
        fioServerHistoryVersion: FIO_SERVER_HISTORY_VERSION_BACKUP,
      });
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedWrapActionsOnFioChain');
    }
    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, false, 0);
    console.log(logPrefix + 'End');
  }

  async handleUnprocessedUnwrapActionsOnEthChainActions() {
    const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnEthChainActions --> `;

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting)) {
      oracleCache.set(
        ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting,
        true,
        0,
      ); // ttl = 0 means that value shouldn't ever been expired
    } else {
      console.log(logPrefix + 'Job is already running');
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
                logPrefix +
                  `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, requesting past unwrap events, Blocks Numbers from ${from} to ${to} ETH Error:`,
              );

              handleChainError({
                logMessage:
                  `ETH ${isTokens ? 'fio.erc20 unwraptokens' : 'fio.erc721 unwrapdomains'} getPastEvents ` +
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
            logPrefix +
              `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, Wrong start blockNumber, pls check stored value.`,
          );

        let fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

        console.log(
          logPrefix +
            `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`,
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
          logPrefix +
            `Unwrap ${isTokens ? 'Tokens' : 'Domain'} events list length: ${result.length}`,
        );
        return result;
      };

      const unwrapTokensData = await getUnprocessedActionsLogs(true);
      const unwrapDomainsData = await getUnprocessedActionsLogs();

      if (unwrapTokensData.length > 0) {
        unwrapTokensData.forEach((item) => {
          const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.ETH,
            message:
              'ETH' +
              ' ' +
              'fio.erc20' +
              ' ' +
              'unwraptokens' +
              ' ' +
              JSON.stringify(item),
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
            message:
              'ETH' +
              ' ' +
              'fio.erc721' +
              ' ' +
              'unwrapdomains' +
              ' ' +
              JSON.stringify(item),
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
        logPrefix + 'isUnwrapOnEthJobExecuting: ' + !!isUnwrapOnEthJobExecuting,
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

    console.log(logPrefix + 'all necessary actions were completed successfully');
  }

  async handleUnprocessedUnwrapActionsOnPolygon() {
    const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnPolygon --> `;

    if (
      !oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting)
    ) {
      oracleCache.set(
        ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting,
        true,
        0,
      ); // ttl = 0 means that value shouldn't ever been expired
    } else {
      console.log(logPrefix + 'Job is already running');
      return;
    }

    console.log(logPrefix + 'Executing');

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
                logPrefix +
                  `requesting past unwrap events, Blocks Numbers from ${from} to ${to} MATIC Error:`,
              );

              handleChainError({
                logMessage:
                  'Polygon' +
                  ' ' +
                  'fio.erc721' +
                  ' ' +
                  'unwrapdomains' +
                  ' ' +
                  'getPastEvents' +
                  ' ' +
                  error,
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
          throw new Error(logPrefix + `Wrong start blockNumber, pls check stored value.`);

        let fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

        console.log(
          logPrefix +
            `start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`,
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

        console.log(logPrefix + `events list length: ${result.length}`);
        return result;
      };

      const data = await getUnprocessedActionsLogs();

      if (data.length > 0) {
        data.forEach((item) => {
          const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.MATIC,
            message:
              'Polygon' +
              ' ' +
              'fio.erc721' +
              ' ' +
              'unwrapdomains' +
              ' ' +
              JSON.stringify(item),
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
        logPrefix + 'isUnwrapOnEthJobExecuting: ' + !!isUnwrapOnPolygonJobExecuting,
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

    console.log(logPrefix + 'all necessary actions were completed successfully');
  }

  async handleUnprocessedBurnNFTActions() {
    const logPrefix = 'FIO, Get latest Burned domain actions on FIO chain --> ';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, true, 0);
    } else {
      console.log(logPrefix + 'Job is already running');
      return;
    }

    const handleBurnNFTAction = async (fioServerHistoryVersion) => {
      const serverType = fioServerHistoryVersion || FIO_SERVER_HISTORY_VERSION;
      const isV2 = serverType === 'hyperion';
      const offset = isV2
        ? parseInt(FIO_HISTORY_HYPERION_OFFSET)
        : parseInt(FIO_HISTORY_OFFSET);

      const lastFioAddressPosition = getLastProceededFioAddressPositionFioChain() || 0;
      const lastProcessedFioBlockNumber =
        getLastProceededBlockNumberOnFioChainForBurnNFT() || 0;
      const lastIrreversibleBlock = (await getLastIrreversibleBlockOnFioChain()) || 0;

      console.log(
        logPrefix +
          `start Position = ${
            isV2 ? lastProcessedFioBlockNumber : lastFioAddressPosition
          }`,
      );

      const processActions = async () => {
        let nextPos = lastFioAddressPosition;
        let nextBefore = lastIrreversibleBlock;
        let hasMoreActions = true;
        const burnedDomainsListFromFio = [];

        while (hasMoreActions) {
          const actionsLogsResult = await getUnprocessedActionsOnFioChain({
            accountName: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
            fioServerHistoryVersion: serverType,
            pos: nextPos,
            offset,
            before: nextBefore,
            after: lastProcessedFioBlockNumber,
          });

          const actionsToProcess =
            actionsLogsResult &&
            actionsLogsResult.actions &&
            actionsLogsResult.actions.length > 0
              ? actionsLogsResult.actions.filter((actionItem) =>
                  new MathOp(actionItem.block_num).lte(lastIrreversibleBlock),
                )
              : [];

          const burnActionsToProcess = actionsToProcess.filter(
            (actionsLogsItem) =>
              actionsLogsItem.action_trace &&
              actionsLogsItem.action_trace.act &&
              actionsLogsItem.action_trace.act.name === 'burndomain',
          );

          const actionsLogsResultLength =
            burnActionsToProcess && burnActionsToProcess.length;

          if (actionsLogsResultLength) {
            console.log(
              `${logPrefix} burn domains events data length: ${burnActionsToProcess.length}`,
            );
            for (const actionsToProcessItem of burnActionsToProcess) {
              if (
                actionsToProcessItem &&
                actionsToProcessItem.action_trace &&
                actionsToProcessItem.action_trace.act &&
                actionsToProcessItem.action_trace.act.data &&
                actionsToProcessItem.action_trace.act.data.domainname
              ) {
                const txId = actionsToProcessItem.action_trace.trx_id;
                if (
                  burnedDomainsListFromFio.includes(
                    (burnedDomainsListItem) => burnedDomainsListItem.trxId === txId,
                  )
                ) {
                  return;
                }

                burnedDomainsListFromFio.push({
                  domainName: actionsToProcessItem.action_trace.act.data.domainname,
                  trxId: txId,
                  data: actionsToProcessItem,
                });
              }
            }

            const lastAction = actionsToProcess[actionsToProcess.length - 1];

            nextPos = new MathOp(nextPos).add(actionsToProcess.length).toString();

            updatefioAddressPositionFIO(nextPos);

            nextBefore = lastAction ? lastAction.block_num - 1 : nextBefore;
          } else {
            if (actionsToProcess && actionsToProcess.length > 0) {
              nextPos = new MathOp(nextPos).add(actionsToProcess.length).toString();
            } else {
              hasMoreActions = false;
            }
          }

          if (!isV2) {
            console.log(`${logPrefix} update FIO Address position to ${nextPos}`);
            updatefioAddressPositionFIO(nextPos.toString());
          }
        }

        console.log(
          'Burned Domains List From Fio Length: ',
          burnedDomainsListFromFio.length,
        );
        if (!burnedDomainsListFromFio.length) return;

        const nftsListToBurn = [];

        console.log('START GETTING MORALIS NFTS');
        const nftsList = await moralis.getAllContractNFTs({
          chainName: NFT_CHAIN_NAME,
          contract: POLYGON_CONTRACT,
        });
        console.log('NFTS LENGTH', nftsList && nftsList.length);

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
            const existingInBurnList = burnedDomainsListFromFio.find(
              (burnedDomainItem) => name === burnedDomainItem.domainName,
            );

            if (existingInBurnList) {
              const { trxId, domainName, data } = existingInBurnList;
              nftsListToBurn.push({
                tokenId: token_id,
                obtId: trxId,
                domainName,
              });

              const existingFIOLogs = fs
                .readFileSync(LOG_FILES_PATH_NAMES.FIO, 'utf-8')
                .toString();

              const isActionDataExists = existingFIOLogs.includes(trxId);

              if (!isActionDataExists && data) {
                addLogMessage({
                  filePath: LOG_FILES_PATH_NAMES.FIO,
                  message: {
                    chain: 'FIO',
                    contract: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
                    action: 'burnDomain MATIC',
                    transaction: JSON.stringify(data),
                  },
                });
              }
            }
          }
        }

        console.log('Nfts List To Burn Lnegth: ', nftsListToBurn.length);

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
      };

      await processActions();

      if (isV2) {
        console.log(
          `${logPrefix} update processed FIO Block Number to ${lastIrreversibleBlock}`,
        );
        updateBlockNumberFIOForBurnNFT(lastIrreversibleBlock.toString());
      }

      const isBurnNFTOnPolygonJobExecuting = oracleCache.get(
        ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting,
      );
      console.log(
        logPrefix + 'isBurnNFTOnPolygonJobExecuting: ' + !!isBurnNFTOnPolygonJobExecuting,
      );

      if (!isBurnNFTOnPolygonJobExecuting) {
        polygonCtrl.burnNFTOnPolygon();
      }
    };

    try {
      await handleBackups(handleBurnNFTAction, false, FIO_SERVER_HISTORY_VERSION_BACKUP);
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedBurnNFTActions');
    }

    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, false, 0);
    console.log(logPrefix + 'End');
  }
}

export default new FIOCtrl();
