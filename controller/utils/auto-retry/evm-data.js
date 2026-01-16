import config from '../../../config/config.js';
import { CONTRACT_ACTIONS } from '../../constants/chain.js';
import { estimateBlockRange } from '../chain.js';
import {
  splitRangeByProvider,
  getBlocksRangeLimitForProvider,
  getBlocksOffsetForProvider,
} from '../logs-range.js';
import {
  createMemoryCheckpoint,
  logMemoryDelta,
  logArraySize,
} from '../memory-logger.js';
import { globalRequestQueue } from '../request-queue.js';
import { Web3Service } from '../web3-services.js';

const {
  autoRetryMissingActions: { maxBlockCacheSize: MAX_BLOCK_CACHE_SIZE = 5000 },
} = config;

// Fetch consensus_activity, wrapped, and unwrapped events for a chain within a time range
export const getChainEvents = async ({ chain, type, timeRangeStart, timeRangeEnd }) => {
  const { chainParams, contractAddress } = chain;
  const { chainCode } = chainParams;
  const logPrefix = `Auto-Retry Missing Actions, ${chainCode} Events -->`;

  const functionStart = createMemoryCheckpoint(
    `getChainEvents ${chainCode} start`,
    logPrefix,
  );

  try {
    const web3Instance = Web3Service.getWe3Instance({ chainCode });

    const currentBlock = Number(await web3Instance.eth.getBlockNumber());
    const blocksOffset = getBlocksOffsetForProvider({ isGetLogs: true });
    const lastInChainBlockNumber = Math.max(0, currentBlock - blocksOffset);
    const blocksInRange = estimateBlockRange(timeRangeEnd);

    // Add 20% buffer to block range to account for:
    // 1. Block time variability
    // 2. Timing mismatches between FIO oracle item creation and EVM consensus signing
    // 3. Network congestion causing slower block times
    const BLOCK_RANGE_BUFFER_PERCENT = 0.2;
    const bufferedBlocksInRange = Math.ceil(
      blocksInRange * (1 + BLOCK_RANGE_BUFFER_PERCENT),
    );

    let fromBlock = Math.max(0, currentBlock - bufferedBlocksInRange);
    let toBlock =
      currentBlock -
      Math.max(
        0,
        estimateBlockRange(timeRangeStart) -
          Math.ceil(blocksInRange * BLOCK_RANGE_BUFFER_PERCENT),
      );
    toBlock = Math.min(toBlock, lastInChainBlockNumber);
    if (fromBlock > toBlock) fromBlock = Math.max(0, toBlock - bufferedBlocksInRange);

    const contract = await Web3Service.getWeb3Contract({
      type,
      chainCode,
      contractAddress,
    });

    const allEvents = [];
    const windows = splitRangeByProvider({ fromBlock, toBlock });

    const fetchWindow = async (start, end) => {
      try {
        const events = await globalRequestQueue.enqueue(
          async () =>
            await contract.getPastEvents('allEvents', {
              fromBlock: start,
              toBlock: end,
            }),
          { logPrefix, from: start, to: end },
        );
        return events || [];
      } catch (err) {
        const msg = (err && err.message) || '';
        const isRangeError =
          (err && err.statusCode === 400) ||
          msg.includes('Exceeded maximum block range') ||
          msg.includes('Maximum allowed number of requested blocks');
        if (!isRangeError) throw err;

        // Get provider's limit based on priority
        const fallbackChunkSize = getBlocksRangeLimitForProvider({ isGetLogs: true });

        const merged = [];
        for (let s = start; s <= end; s += fallbackChunkSize) {
          const e = Math.min(end, s + fallbackChunkSize - 1);
          const part = await globalRequestQueue.enqueue(
            async () =>
              await contract.getPastEvents('allEvents', {
                fromBlock: s,
                toBlock: e,
              }),
            { logPrefix, from: s, to: e },
          );
          if (part && part.length) merged.push(...part);
        }
        return merged;
      }
    };

    const beforeEventFetch = createMemoryCheckpoint(
      `Before fetching events ${chainCode}`,
      logPrefix,
    );
    for (const w of windows) {
      const chunk = await fetchWindow(w.from, w.to);
      if (chunk && chunk.length) allEvents.push(...chunk);
    }
    logMemoryDelta(`After fetching all events ${chainCode}`, beforeEventFetch, logPrefix);
    logArraySize(`${chainCode} allEvents`, allEvents, logPrefix);

    // Fetch block timestamps with memory-efficient caching
    // Limit cache size to prevent memory exhaustion (configurable in config)
    const uniqueBlockNumbers = [...new Set(allEvents.map((event) => event.blockNumber))];
    const blockTimestamps = new Map();

    console.log(
      `${logPrefix} Fetching timestamps for ${uniqueBlockNumbers.length} unique blocks`,
    );
    const beforeBlockFetch = createMemoryCheckpoint(
      `Before fetching blocks ${chainCode}`,
      logPrefix,
    );

    for (const blockNumber of uniqueBlockNumbers) {
      // Evict oldest entries if cache grows too large (simple FIFO)
      if (blockTimestamps.size >= MAX_BLOCK_CACHE_SIZE) {
        const firstKey = blockTimestamps.keys().next().value;
        blockTimestamps.delete(firstKey);
      }

      const block = await globalRequestQueue.enqueue(
        async () => await web3Instance.eth.getBlock(blockNumber),
        { logPrefix, from: blockNumber, to: blockNumber },
      );
      blockTimestamps.set(blockNumber, Number(block.timestamp) * 1000);
    }
    logMemoryDelta(
      `After fetching block timestamps ${chainCode}`,
      beforeBlockFetch,
      logPrefix,
    );
    console.log(
      `${logPrefix} Block timestamp cache size: ${blockTimestamps.size} entries (~${(blockTimestamps.size * 0.05).toFixed(2)}MB)`,
    );

    // Time filter with progress logging
    const beforeFilter = createMemoryCheckpoint(
      `Before filtering events ${chainCode}`,
      logPrefix,
    );
    const now = Date.now();
    const filteredEvents = allEvents.filter((event) => {
      const blockTimestamp = blockTimestamps.get(event.blockNumber);
      return (
        blockTimestamp >= now - timeRangeEnd && blockTimestamp <= now - timeRangeStart
      );
    });

    console.log(
      `${logPrefix} Filtered ${filteredEvents.length} events (from ${allEvents.length} total) within time range`,
    );
    logMemoryDelta(`After filtering events ${chainCode}`, beforeFilter, logPrefix);
    logArraySize(`${chainCode} filteredEvents`, filteredEvents, logPrefix);

    // Clear large arrays to free memory
    const beforeCleanup = createMemoryCheckpoint(
      `Before cleanup ${chainCode}`,
      logPrefix,
    );
    allEvents.length = 0;
    blockTimestamps.clear();
    logMemoryDelta(
      `After clearing allEvents and blockTimestamps ${chainCode}`,
      beforeCleanup,
      logPrefix,
    );

    // Split by event type
    const beforeSplit = createMemoryCheckpoint(
      `Before splitting events ${chainCode}`,
      logPrefix,
    );
    const consensusEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.CONSENSUS_ACTIVITY,
    );
    const wrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
    );
    const unwrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.UNWRAPPED,
    );
    logMemoryDelta(`After splitting events ${chainCode}`, beforeSplit, logPrefix);

    // Note: filteredEvents still exists here and will be GC'd when function exits
    logMemoryDelta(`getChainEvents ${chainCode} complete`, functionStart, logPrefix);

    return { consensusEvents, wrappedEvents, unwrappedEvents };
  } catch (error) {
    console.error(`${logPrefix} Error fetching chain events:`, error.message);
    return { consensusEvents: [], wrappedEvents: [], unwrappedEvents: [] };
  }
};
