import { Web3Service } from './web3-services.js';

export const MORALIS_SAFE_BLOCKS_PER_QUERY = 95;
export const THIRDWEB_SAFE_BLOCKS_PER_QUERY = 995;

// Returns true if the active provider for the chain looks like Moralis
export const isMoralisProviderActive = ({ chainCode }) => {
  const name = Web3Service.getCurrentRpcProviderName({ chainCode }) || '';
  return name.toLowerCase().includes('moralis');
};

// Returns true if the active provider for the chain looks like Thirdweb
export const isThirdwebProviderActive = ({ chainCode }) => {
  const name = Web3Service.getCurrentRpcProviderName({ chainCode }) || '';
  return name.toLowerCase().includes('thirdweb');
};

// Returns true if Moralis provider exists in the provider chain (may be used as fallback)
export const hasMoralisInProviderChain = ({ chainCode }) => {
  return Web3Service.hasMoralisProvider({ chainCode });
};

// Returns true if Thirdweb provider exists in the provider chain (may be used as fallback)
export const hasThirdwebInProviderChain = ({ chainCode }) => {
  return Web3Service.hasThirdwebProvider({ chainCode });
};

// Returns the safe block limit based on ALL providers that might be used in fallback chain
// For eth_getLogs, the order is Thirdweb → Moralis → others, so we need the smallest limit
export const getSafeBlocksForProviderChain = ({ chainCode }) => {
  // Check if Moralis exists in the chain (has the smallest limit at 95)
  if (hasMoralisInProviderChain({ chainCode })) {
    return MORALIS_SAFE_BLOCKS_PER_QUERY;
  }
  // Check if Thirdweb exists in the chain (limit of 1000)
  if (hasThirdwebInProviderChain({ chainCode })) {
    return THIRDWEB_SAFE_BLOCKS_PER_QUERY;
  }
  // Infura and others: no special limit
  return null;
};

// Split a [fromBlock, toBlock] range into windows using a provider-aware chunk size
// preferChunk: desired chunk size (e.g., 3000 or the whole window length)
// moralisMax: max chunk size for Moralis (default 95 to stay under 100)
// thirdwebMax: max chunk size for Thirdweb (default 1000)
export const splitRangeByProvider = ({
  chainCode,
  fromBlock,
  toBlock,
  preferChunk,
  moralisMax = MORALIS_SAFE_BLOCKS_PER_QUERY,
  thirdwebMax = THIRDWEB_SAFE_BLOCKS_PER_QUERY,
}) => {
  const from = Number(fromBlock);
  const to = Number(toBlock);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  // Determine the chunk size based on which providers EXIST in the chain
  // For eth_getLogs, the provider order is: Thirdweb → Moralis → others
  // We must use the smallest limit that works for ALL providers in the fallback chain
  // Moralis: 95 blocks, Thirdweb: 1000 blocks, Infura/others: use preferChunk
  const hasMoralis = hasMoralisInProviderChain({ chainCode });
  const hasThirdweb = hasThirdwebInProviderChain({ chainCode });

  let providerMax = preferChunk;
  if (hasMoralis) {
    // Moralis has the smallest limit, use it if Moralis is in the chain
    providerMax = moralisMax;
  } else if (hasThirdweb) {
    // Thirdweb has a 1000 block limit
    providerMax = thirdwebMax;
  }

  const chunk = Math.max(1, Math.min(preferChunk, providerMax));

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
  preferChunk,
  moralisMax = MORALIS_SAFE_BLOCKS_PER_QUERY,
  thirdwebMax = THIRDWEB_SAFE_BLOCKS_PER_QUERY,
}) => {
  const windows = splitRangeByProvider({
    chainCode,
    fromBlock,
    toBlock,
    preferChunk,
    moralisMax,
    thirdwebMax,
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

  // Use the smallest safe limit for fallback (Moralis at 95 is safest)
  const fallbackChunkSize = Math.min(moralisMax, thirdwebMax);

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
