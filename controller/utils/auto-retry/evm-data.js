import config from '../../../config/config.js';
import { CONTRACT_ACTIONS } from '../../constants/chain.js';
import { estimateBlockRange } from '../chain.js';
import { splitRangeByProvider, MORALIS_SAFE_BLOCKS_PER_QUERY } from '../logs-range.js';
import { globalRequestQueue } from '../request-queue.js';
import { Web3Service } from '../web3-services.js';

const {
  autoRetryMissingActions: { maxBlockCacheSize: MAX_BLOCK_CACHE_SIZE = 5000 },
} = config;

// Fetch consensus_activity, wrapped, and unwrapped events for a chain within a time range
export const getChainEvents = async ({ chain, type, timeRangeStart, timeRangeEnd }) => {
  const { chainParams, contractAddress, blocksOffset = 0 } = chain;
  const { chainCode } = chainParams;
  const logPrefix = `Auto-Retry Missing Actions, ${chainCode} Events -->`;

  try {
    const web3Instance = Web3Service.getWe3Instance({ chainCode });

    const currentBlock = Number(await web3Instance.eth.getBlockNumber());
    const lastInChainBlockNumber = Math.max(0, currentBlock - Number(blocksOffset || 0));
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
    const windows = splitRangeByProvider({
      chainCode,
      fromBlock,
      toBlock,
      preferChunk: toBlock - fromBlock + 1,
      moralisMax: MORALIS_SAFE_BLOCKS_PER_QUERY,
    });

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
          (err && err.statusCode === 400) || msg.includes('Exceeded maximum block range');
        if (!isRangeError) throw err;

        const merged = [];
        for (let s = start; s <= end; s += MORALIS_SAFE_BLOCKS_PER_QUERY) {
          const e = Math.min(end, s + MORALIS_SAFE_BLOCKS_PER_QUERY - 1);
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

    for (const w of windows) {
      const chunk = await fetchWindow(w.from, w.to);
      if (chunk && chunk.length) allEvents.push(...chunk);
    }

    // Fetch block timestamps with memory-efficient caching
    // Limit cache size to prevent memory exhaustion (configurable in config)
    const uniqueBlockNumbers = [...new Set(allEvents.map((event) => event.blockNumber))];
    const blockTimestamps = new Map();

    console.log(
      `${logPrefix} Fetching timestamps for ${uniqueBlockNumbers.length} unique blocks`,
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

    // Time filter with progress logging
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

    // Clear large arrays to free memory
    allEvents.length = 0;
    blockTimestamps.clear();

    // Split by event type
    const consensusEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.CONSENSUS_ACTIVITY,
    );
    const wrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
    );
    const unwrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.UNWRAPPED,
    );

    return { consensusEvents, wrappedEvents, unwrappedEvents };
  } catch (error) {
    console.error(`${logPrefix} Error fetching chain events:`, error.message);
    return { consensusEvents: [], wrappedEvents: [], unwrappedEvents: [] };
  }
};
