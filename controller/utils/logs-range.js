import config from '../../config/config.js';

// Get provider config by priority (lowest number = highest priority)
// isGetLogs: true = use GET_LOGS_PRIORITY, false = use PRIORITY
// Returns { name, config, priority }
export const getProviderByPriority = ({ isGetLogs = false }) => {
  const priorityKey = isGetLogs ? 'GET_LOGS_PRIORITY' : 'PRIORITY';

  let bestName = null;
  let bestConfig = null;
  let bestPriority = Infinity;

  for (const [name, providerConfig] of Object.entries(config.web3Providers)) {
    const priority = providerConfig[priorityKey];
    if (priority != null && priority < bestPriority) {
      bestPriority = priority;
      bestName = name;
      bestConfig = providerConfig;
    }
  }

  return { name: bestName, config: bestConfig, priority: bestPriority };
};

// Get blocksRangeLimit based on priority provider
export const getBlocksRangeLimitForProvider = ({ isGetLogs = false }) => {
  const provider = getProviderByPriority({ isGetLogs });

  if (!provider.config || !provider.config.BLOCKS_RANGE_LIMIT) {
    throw new Error(`Can't find provider's blocksRangeLimit, check your config`);
  }

  return provider.config.BLOCKS_RANGE_LIMIT;
};

// Get blocksOffset based on priority (not chainCode)
export const getBlocksOffsetForProvider = ({ isGetLogs = false }) => {
  const provider = getProviderByPriority({ isGetLogs });

  if (!provider.config || provider.config.BLOCKS_OFFSET == null) {
    throw new Error(`Can't find provider's blocksOffset, check your config`);
  }

  return provider.config.BLOCKS_OFFSET;
};

// Log which provider will be used for getLogs
export const logGetLogsProvider = ({ logPrefix = '' }) => {
  const provider = getProviderByPriority({ isGetLogs: true });
  if (logPrefix && provider.name) {
    console.log(
      `${logPrefix} Using provider "${provider.name}" for eth_getLogs (priority: ${provider.priority}, blocksRangeLimit: ${provider.config.BLOCKS_RANGE_LIMIT})`,
    );
  }
  return provider;
};

// Split a [fromBlock, toBlock] range into windows based on getLogs provider's limit
export const splitRangeByProvider = ({ fromBlock, toBlock }) => {
  const from = Number(fromBlock);
  const to = Number(toBlock);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  // Get the provider that will handle eth_getLogs
  const chunk = getBlocksRangeLimitForProvider({ isGetLogs: true });

  const windows = [];
  for (let start = from; start <= to; start += chunk) {
    const end = Math.min(to, start + chunk - 1);
    windows.push({ from: start, to: end });
  }
  return windows;
};

// Fetch events across a block range with provider-aware windowing and safe fallback
// contract: web3.eth.Contract instance
// eventName: 'allEvents' or a specific event string
// queue: request queue to throttle calls
export const fetchEventsChunked = async ({
  contract,
  eventName,
  fromBlock,
  toBlock,
  logPrefix = '',
  queue,
}) => {
  const windows = splitRangeByProvider({ fromBlock, toBlock });

  const combined = [];

  const tryWindow = async (start, end) =>
    await queue.enqueue(
      async () => {
        if (logPrefix) {
          console.log(`${logPrefix} Fetching events from block ${start} to ${end}...`);
        }
        return await contract.getPastEvents(eventName, {
          fromBlock: start,
          toBlock: end,
        });
      },
      { logPrefix, from: start, to: end },
    );

  for (const w of windows) {
    try {
      const part = await tryWindow(w.from, w.to);
      if (part && part.length) combined.push(...part);
    } catch (err) {
      const msg = (err && err.message) || '';
      const isRangeError =
        (err && err.statusCode === 400) ||
        msg.includes('Exceeded maximum block range') ||
        msg.includes('Maximum allowed number of requested blocks');
      if (!isRangeError) throw err;

      // Get provider's limit for getLogs based on priority
      const fallbackChunkSize = getBlocksRangeLimitForProvider({ isGetLogs: true });

      if (logPrefix) {
        console.warn(
          `${logPrefix} Window ${w.from}-${w.to} failed (${msg}). Retrying with ${fallbackChunkSize}-block chunks...`,
        );
      }
      for (let s = w.from; s <= w.to; s += fallbackChunkSize) {
        const e = Math.min(w.to, s + fallbackChunkSize - 1);
        const sub = await tryWindow(s, e);
        if (sub && sub.length) combined.push(...sub);
      }
    }
  }

  return combined;
};
