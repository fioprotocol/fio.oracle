import config from '../../config/config.js';

import fioCtrl from '../api/fio.js';
import { ACTIONS, CONTRACT_ACTIONS } from '../constants/chain.js';
import { ORACLE_CACHE_KEYS, ORACLE_JOB_TYPES } from '../constants/cron-jobs.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { getOracleCacheKey } from '../utils/cron-jobs.js';
import { stringifyWithBigInt } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  handleServerError,
  updateBlockNumber,
  getLastProcessedBlockNumber,
  addLogMessage,
} from '../utils/log-files.js';
import MathOp from '../utils/math.js';
import { globalRequestQueue } from '../utils/request-queue.js';
import { Web3Service } from '../utils/web3-services.js';

const { oracleCache, supportedChains } = config;

export const handleUnwrap = async () => {
  // All chains will use the global request queue to avoid rate limiting
  let isFirstChain = true;

  for (const [type, chains] of Object.entries(supportedChains)) {
    for (const chain of chains) {
      const {
        blocksRangeLimit,
        blocksOffset = 0,
        infura,
        contractAddress,
        contractTypeName,
        chainParams,
      } = chain;

      const { chainCode } = chainParams || {};
      const cacheKey = getOracleCacheKey({
        actionName: ACTIONS.UNWRAP,
        type,
        chainCode,
        jobType: ORACLE_JOB_TYPES.EVENT_DETECTION,
      });

      const logPrefix = `${chainCode}, ${type}, Unwrap -->`;

      if (!oracleCache.get(cacheKey)) {
        oracleCache.set(cacheKey, true, 0);
      } else {
        console.log(`${logPrefix} Job is already running`);
        continue; // Skip this chain but continue processing others
      }

      // Add significant delay between chains to ensure rate limit windows reset
      if (!isFirstChain) {
        const chainDelay = SECOND_IN_MILLISECONDS * 3; // 3 seconds between chains (full reset)
        console.log(
          `${logPrefix} Waiting ${chainDelay / SECOND_IN_MILLISECONDS}s before processing to reset rate limits...`,
        );
        await new Promise((resolve) => setTimeout(resolve, chainDelay));
      }
      isFirstChain = false;

      try {
        // Get contract instance once for all requests
        const contract = await Web3Service.getWeb3Contract({
          apiKey: infura.apiKey,
          type,
          chainCode,
          contractAddress,
          rpcUrl: infura.rpcUrl,
        });

        const getActionsLogs = async ({ from, to }) => {
          // Enqueue the request through the global queue
          // The queue handles rate limiting and retries automatically
          return await globalRequestQueue.enqueue(
            async () => {
              console.log(`${logPrefix} Fetching events from block ${from} to ${to}...`);

              const events = await contract.getPastEvents(CONTRACT_ACTIONS.UNWRAPPED, {
                fromBlock: from,
                toBlock: to,
              });

              return events;
            },
            {
              logPrefix,
              from,
              to,
            },
          );
        };

        const getUnprocessedActionsLogs = async () => {
          const web3ChainInstance = Web3Service.getWe3Instance({
            chainCode,
            rpcUrl: infura.rpcUrl,
            apiKey: infura.apiKey,
          });

          const chainBlockNumber = await web3ChainInstance.eth.getBlockNumber();
          const lastInChainBlockNumber = new MathOp(parseInt(chainBlockNumber))
            .sub(blocksOffset)
            .toNumber();

          const lastProcessedBlockNumber = getLastProcessedBlockNumber({ chainCode });

          if (new MathOp(lastProcessedBlockNumber).gt(lastInChainBlockNumber))
            throw new Error(
              `${logPrefix} ${ACTIONS.UNWRAP} ${type} Wrong start blockNumber, pls check stored value.`,
            );

          let fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

          console.log(
            `${logPrefix} ${ACTIONS.UNWRAP} ${type} start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`,
          );

          const result = [];
          let maxCheckedBlockNumber = 0;
          let requestCount = 0;

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

            updateBlockNumber({
              chainCode,
              blockNumber: maxCheckedBlockNumber.toString(),
            });

            const events = await getActionsLogs({
              from: fromBlockNumber,
              to: toBlockNumber,
            });

            if (events && events.length) {
              result.push(...events);
            }

            fromBlockNumber = new MathOp(toBlockNumber).add(1).toNumber();
            requestCount++;

            // Log progress every 10 requests
            if (requestCount % 10 === 0) {
              console.log(`${logPrefix} Processed ${requestCount} batches...`);
              globalRequestQueue.printStats(`${logPrefix} `);
            }
          }

          console.log(
            `${logPrefix} ${ACTIONS.UNWRAP} ${type} events list length: ${result.length}`,
          );
          globalRequestQueue.printStats(`${logPrefix} `);
          return result;
        };

        const unwrapData = await getUnprocessedActionsLogs();
        console.log(`${logPrefix} unwrapData length: ${unwrapData.length}`);
        if (unwrapData.length > 0) {
          for (const unwrapItem of unwrapData) {
            const logText = `${unwrapItem.transactionHash} ${stringifyWithBigInt(unwrapItem.returnValues)}`;

            addLogMessage({
              filePath: getLogFilePath({ key: LOG_FILES_KEYS.CHAIN, chainCode, type }),
              message: `${chainCode} ${ACTIONS.UNWRAP} ${type} ${contractTypeName} ${stringifyWithBigInt(unwrapItem)}`,
            });

            addLogMessage({
              filePath: getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP, chainCode, type }),
              message: logText,
              addTimestamp: false,
            });
          }
        }

        // Check if FIO transaction processing job is already running (global check)
        const isUnwrapFioTxJobExecuting = oracleCache.get(
          ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting,
        );
        console.log(
          `${logPrefix} isUnwrapFioTxJobExecuting: ${!!isUnwrapFioTxJobExecuting}`,
        );

        if (!isUnwrapFioTxJobExecuting) {
          fioCtrl.handleUnwrapFromOtherChainsToFioChain();
        }
      } catch (error) {
        console.error(`${logPrefix} Chain processing failed:`, error.message || error);
        handleServerError(error, `${chainCode}, ${ACTIONS.UNWRAP} ${type}`);
        // Continue to next chain even if this one failed
      } finally {
        oracleCache.set(cacheKey, false, 0);
        console.log(`${logPrefix} Chain processing completed (success or error).`);
      }
    }
  }

  // Print final queue statistics
  console.log('='.repeat(60));
  globalRequestQueue.printStats('All chains completed --> ');
  console.log('='.repeat(60));
};
