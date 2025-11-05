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
import {
  splitRangeByProvider,
  MORALIS_SAFE_BLOCKS_PER_QUERY,
} from '../utils/logs-range.js';
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
          type,
          chainCode,
          contractAddress,
        });

        const getActionsLogs = async ({ from, to }) => {
          const tryWindow = async (start, end) =>
            await globalRequestQueue.enqueue(
              async () => {
                console.log(
                  `${logPrefix} Fetching events from block ${start} to ${end}...`,
                );
                return await contract.getPastEvents(CONTRACT_ACTIONS.UNWRAPPED, {
                  fromBlock: start,
                  toBlock: end,
                });
              },
              { logPrefix, from: start, to: end },
            );

          const windows = splitRangeByProvider({
            chainCode,
            fromBlock: from,
            toBlock: to,
            // prefer the whole window when not Moralis; util will clamp to 99 if Moralis
            preferChunk: to - from + 1,
            moralisMax: MORALIS_SAFE_BLOCKS_PER_QUERY,
          });

          const combined = [];

          const fetchWindow = async (start, end) => {
            try {
              const part = await tryWindow(start, end);
              return part || [];
            } catch (err) {
              const msg = (err && err.message) || '';
              const isRangeError =
                err?.statusCode === 400 || msg.includes('Exceeded maximum block range');
              if (!isRangeError) throw err;

              console.warn(
                `${logPrefix} Window ${start}-${end} failed (${msg}). Retrying with ${MORALIS_SAFE_BLOCKS_PER_QUERY}-block chunks...`,
              );
              const merged = [];
              for (let s = start; s <= end; s += MORALIS_SAFE_BLOCKS_PER_QUERY) {
                const e = Math.min(end, s + MORALIS_SAFE_BLOCKS_PER_QUERY - 1);
                const sub = await tryWindow(s, e);
                if (sub && sub.length) merged.push(...sub);
              }
              return merged;
            }
          };

          for (const w of windows) {
            const part = await fetchWindow(w.from, w.to);
            if (part && part.length) combined.push(...part);
          }
          return combined;
        };

        const getUnprocessedActionsLogs = async () => {
          const web3ChainInstance = Web3Service.getWe3Instance({ chainCode });

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
