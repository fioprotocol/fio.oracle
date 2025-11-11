import { Web3Service } from './web3-services.js';

export const MORALIS_SAFE_BLOCKS_PER_QUERY = 95;
export const DEFAULT_BLOCKS_PER_QUERY = 950;

// Returns true if the active provider for the chain looks like Moralis
export const isMoralisProviderActive = ({ chainCode }) => {
  const name = Web3Service.getCurrentRpcProviderName({ chainCode }) || '';
  return name.toLowerCase().includes('moralis');
};

// Split a [fromBlock, toBlock] range into windows using a provider-aware chunk size
// preferChunk: desired chunk size (e.g., 950 or the whole window length)
// moralisMax: max chunk size for Moralis (default 99 to stay under 100)
export const splitRangeByProvider = ({
  chainCode,
  fromBlock,
  toBlock,
  preferChunk = DEFAULT_BLOCKS_PER_QUERY,
  moralisMax = MORALIS_SAFE_BLOCKS_PER_QUERY,
}) => {
  const from = Number(fromBlock);
  const to = Number(toBlock);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  // If ANY Moralis provider is configured for this chain, cap chunks to moralisMax (<=99)
  // This avoids Moralis 400 errors even if a non-Moralis provider is currently active
  const hasMoralis = Web3Service.hasMoralisProvider({ chainCode });
  const isMoralisActive = isMoralisProviderActive({ chainCode });
  const shouldCapToMoralis = hasMoralis || isMoralisActive;
  const chunk = Math.max(
    1,
    Math.min(preferChunk, shouldCapToMoralis ? moralisMax : preferChunk),
  );

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
  chainCode,
  fromBlock,
  toBlock,
  logPrefix = '',
  queue,
  preferChunk = DEFAULT_BLOCKS_PER_QUERY,
  moralisMax = MORALIS_SAFE_BLOCKS_PER_QUERY,
}) => {
  const windows = splitRangeByProvider({
    chainCode,
    fromBlock,
    toBlock,
    preferChunk,
    moralisMax,
  });

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
        (err && err.statusCode === 400) || msg.includes('Exceeded maximum block range');
      if (!isRangeError) throw err;

      if (logPrefix) {
        console.warn(
          `${logPrefix} Window ${w.from}-${w.to} failed (${msg}). Retrying with ${moralisMax}-block chunks...`,
        );
      }
      for (let s = w.from; s <= w.to; s += moralisMax) {
        const e = Math.min(w.to, s + moralisMax - 1);
        const sub = await tryWindow(s, e);
        if (sub && sub.length) combined.push(...sub);
      }
    }
  }

  return combined;
};
