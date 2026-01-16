import { getCachedEvents, getCacheStats } from './event-cache.js';
import config from '../../config/config.js';

import fioCtrl from '../api/fio.js';
import { ACTIONS, CONTRACT_ACTIONS } from '../constants/chain.js';
import { ORACLE_CACHE_KEYS, ORACLE_JOB_TYPES } from '../constants/cron-jobs.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import {
  getOracleCacheKey,
  acquireJobLock,
  releaseJobLock,
  isJobLocked,
} from '../utils/cron-jobs.js';
import { stringifyWithBigInt } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  handleServerError,
  getLastProcessedBlockNumber,
  updateUnwrapProcessedBlockNumber,
  getLastUnwrapProcessedBlockNumber,
  isUnwrapTransactionInFioLog,
  addLogMessage,
} from '../utils/log-files.js';
import { getBlocksOffsetForProvider } from '../utils/logs-range.js';
import MathOp from '../utils/math.js';
import {
  createMemoryCheckpoint,
  logMemoryDelta,
  logArraySize,
  forceGCAndLog,
} from '../utils/memory-logger.js';
import { Web3Service } from '../utils/web3-services.js';

const { supportedChains } = config;

export const handleUnwrap = async () => {
  // All chains will use the global request queue to avoid rate limiting
  let isFirstChain = true;

  for (const [type, chains] of Object.entries(supportedChains)) {
    for (const chain of chains) {
      const {
        // contractAddress,
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

      if (!acquireJobLock(cacheKey, logPrefix)) {
        continue; // Skip this chain but continue processing others
      }

      // Initialize variables outside try block for use in finally
      let chainStartCheckpoint = null;
      let allCachedEvents = null;
      let eventsInRange = null;
      let eventsToProcess = null;

      try {
        // Add significant delay between chains to ensure rate limit windows reset
        if (!isFirstChain) {
          const chainDelay = SECOND_IN_MILLISECONDS * 3; // 3 seconds between chains (full reset)
          console.log(
            `${logPrefix} Waiting ${chainDelay / SECOND_IN_MILLISECONDS}s before processing to reset rate limits...`,
          );
          await new Promise((resolve) => setTimeout(resolve, chainDelay));
        }
        isFirstChain = false;

        // Create memory checkpoint at start of chain processing
        chainStartCheckpoint = createMemoryCheckpoint(
          `Start processing ${chainCode} ${type}`,
          logPrefix,
        );
        // Get cache statistics
        const cacheStats = getCacheStats({ chainCode, type });
        if (cacheStats.exists) {
          console.log(
            `${logPrefix} Cache stats: ${cacheStats.eventCount} events, ` +
              `age: ${Math.round(cacheStats.age / 1000)}s`,
          );
        } else {
          console.log(`${logPrefix} Cache not ready yet, will retry on next run`);
        }

        // Get current chain block number
        const web3ChainInstance = Web3Service.getWe3Instance({ chainCode });
        const chainBlockNumber = await web3ChainInstance.eth.getBlockNumber();
        const blocksOffset = getBlocksOffsetForProvider({ isGetLogs: true });
        const lastInChainBlockNumber = new MathOp(parseInt(chainBlockNumber))
          .sub(blocksOffset)
          .toNumber();

        // Get event cache's last processed block number (upper limit for what's been fetched)
        let eventCacheBlockNumber;
        try {
          eventCacheBlockNumber = getLastProcessedBlockNumber({ chainCode });
        } catch {
          console.log(
            `${logPrefix} Event cache block number file not found, using chain block: ${lastInChainBlockNumber}`,
          );
          eventCacheBlockNumber = lastInChainBlockNumber;
        }

        // Get unwrap processed block number (tracks which blocks we've checked for unwrap)
        let lastUnwrapProcessedBlock = getLastUnwrapProcessedBlockNumber({ chainCode });
        if (lastUnwrapProcessedBlock === null || isNaN(lastUnwrapProcessedBlock)) {
          // First time running or invalid value - initialize to event cache's block number
          // This ensures we only process NEW events going forward, not old cached events
          lastUnwrapProcessedBlock = eventCacheBlockNumber;

          // Validate that eventCacheBlockNumber is valid
          if (isNaN(lastUnwrapProcessedBlock) || lastUnwrapProcessedBlock < 0) {
            console.warn(
              `${logPrefix} Invalid event cache block number (${eventCacheBlockNumber}), using chain block: ${lastInChainBlockNumber}`,
            );
            lastUnwrapProcessedBlock = lastInChainBlockNumber;
          }

          updateUnwrapProcessedBlockNumber({
            chainCode,
            blockNumber: lastUnwrapProcessedBlock.toString(),
          });
          console.log(
            `${logPrefix} First run or invalid value: Initialized unwrap processed block number to ${lastUnwrapProcessedBlock} ` +
              `(will only process new events going forward)`,
          );
        }

        // Check events from the last unwrap processed block + 1 up to the event cache's block number
        const fromBlockNumber = new MathOp(lastUnwrapProcessedBlock).add(1).toNumber();
        const toBlockNumber = Math.min(eventCacheBlockNumber, lastInChainBlockNumber);

        console.log(
          `${logPrefix} Checking unwrap events from block ${fromBlockNumber} to ${toBlockNumber} ` +
            `(event cache is at block ${eventCacheBlockNumber})`,
        );

        // Get all cached unwrapped events
        const beforeFetchCheckpoint = createMemoryCheckpoint(
          `Before fetching cached events`,
          logPrefix,
        );
        allCachedEvents = getCachedEvents({
          chainCode,
          type,
          eventType: CONTRACT_ACTIONS.UNWRAPPED,
        });
        logMemoryDelta(`After fetching cached events`, beforeFetchCheckpoint, logPrefix);
        logArraySize('allCachedEvents', allCachedEvents, logPrefix);

        // Filter events in the block range we're checking
        // Only process events in the normal range - missed events are handled by auto-retry-missing-actions
        const beforeFilterCheckpoint = createMemoryCheckpoint(
          `Before filtering events by block range`,
          logPrefix,
        );
        eventsInRange = allCachedEvents.filter((event) => {
          const blockNumber = parseInt(event.blockNumber);
          return blockNumber >= fromBlockNumber && blockNumber <= toBlockNumber;
        });

        // Sort by block number to process in order
        eventsInRange.sort((a, b) => parseInt(a.blockNumber) - parseInt(b.blockNumber));
        logMemoryDelta(
          `After filtering events by block range`,
          beforeFilterCheckpoint,
          logPrefix,
        );
        logArraySize('eventsInRange', eventsInRange, logPrefix);

        console.log(
          `${logPrefix} Found ${eventsInRange.length} unwrapped events in cache ` +
            `(from ${allCachedEvents.length} total cached events)`,
        );

        // Filter out events that are already processed in FIO.log
        const beforeFioCheckCheckpoint = createMemoryCheckpoint(
          `Before checking FIO.log`,
          logPrefix,
        );
        eventsToProcess = [];
        let skippedAlreadyProcessed = 0;

        for (const event of eventsInRange) {
          const txHash = event.transactionHash;
          if (isUnwrapTransactionInFioLog(txHash)) {
            skippedAlreadyProcessed++;
            console.log(
              `${logPrefix} Skipping event at block ${event.blockNumber}, txHash ${txHash} - already in FIO.log`,
            );
          } else {
            eventsToProcess.push(event);
          }
        }
        logMemoryDelta(`After checking FIO.log`, beforeFioCheckCheckpoint, logPrefix);
        logArraySize('eventsToProcess', eventsToProcess, logPrefix);

        if (skippedAlreadyProcessed > 0) {
          console.log(
            `${logPrefix} Skipped ${skippedAlreadyProcessed} event(s) already processed in FIO.log`,
          );
        }

        console.log(
          `${logPrefix} Processing ${eventsToProcess.length} new unwrap event(s)`,
        );

        // Process events that aren't already in FIO.log
        if (eventsToProcess.length > 0) {
          const beforeProcessingCheckpoint = createMemoryCheckpoint(
            `Before processing events`,
            logPrefix,
          );
          let highestProcessedBlock = lastUnwrapProcessedBlock;

          for (const unwrapItem of eventsToProcess) {
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

            // Update highest processed block
            const eventBlockNumber = parseInt(unwrapItem.blockNumber);
            if (eventBlockNumber > highestProcessedBlock) {
              highestProcessedBlock = eventBlockNumber;
            }
          }
          logMemoryDelta(
            `After processing events`,
            beforeProcessingCheckpoint,
            logPrefix,
          );

          // Update unwrap processed block number to the highest block we've checked
          updateUnwrapProcessedBlockNumber({
            chainCode,
            blockNumber: highestProcessedBlock.toString(),
          });
          console.log(
            `${logPrefix} Updated unwrap processed block number to ${highestProcessedBlock} ` +
              `(queued ${eventsToProcess.length} event(s) for FIO processing)`,
          );
        } else {
          // No new events to process, but we've checked up to toBlockNumber
          // Update unwrap processed block number to reflect we've checked this range
          if (toBlockNumber >= fromBlockNumber) {
            updateUnwrapProcessedBlockNumber({
              chainCode,
              blockNumber: toBlockNumber.toString(),
            });
            console.log(
              `${logPrefix} Updated unwrap processed block number to ${toBlockNumber} ` +
                `(no new events to process)`,
            );
          }
        }

        // Clean up arrays to free memory
        const beforeCleanupCheckpoint = createMemoryCheckpoint(
          `Before cleanup`,
          logPrefix,
        );
        if (allCachedEvents) allCachedEvents.length = 0;
        if (eventsInRange) eventsInRange.length = 0;
        if (eventsToProcess) eventsToProcess.length = 0;
        logMemoryDelta(`After cleanup`, beforeCleanupCheckpoint, logPrefix);

        // Check if FIO transaction processing job is already running (global check)
        const isUnwrapFioTxJobExecuting = isJobLocked(
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
        // Force GC and log memory delta for this chain
        forceGCAndLog(logPrefix);
        if (chainStartCheckpoint) {
          logMemoryDelta(
            `Final memory (end of chain processing)`,
            chainStartCheckpoint,
            logPrefix,
          );
        }

        releaseJobLock(cacheKey);
        console.log(`${logPrefix} Chain processing completed (success or error).`);
      }
    }
  }

  console.log('='.repeat(60));
  console.log('[Unwrap] All chains completed');
  console.log('='.repeat(60));
};
