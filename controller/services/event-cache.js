/**
 * Event Cache Service
 *
 * Fetches blockchain events once per minute and caches them.
 * Other services (unwrap, auto-retry) read from cache instead of querying blockchain repeatedly.
 *
 * Benefits:
 * - Single source of truth for events
 * - Eliminates duplicate API calls
 * - Auto-retry reads from cache = ZERO blockchain calls
 * - Keeps 1 hour of events, auto-cleans old data
 */

import fs from 'fs';

import config from '../../config/config.js';
import { HOUR_IN_MILLISECONDS } from '../constants/general.js';
import { stringifyWithBigInt } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  addLogMessage,
  getLastProcessedBlockNumber,
  handleServerError,
  updateBlockNumber,
} from '../utils/log-files.js';
import {
  splitRangeByProvider,
  MORALIS_SAFE_BLOCKS_PER_QUERY,
} from '../utils/logs-range.js';
import MathOp from '../utils/math.js';
import { globalRequestQueue } from '../utils/request-queue.js';
import { Web3Service } from '../utils/web3-services.js';

const { supportedChains } = config;

// Cache retention: 1 hour
const CACHE_RETENTION_MS = HOUR_IN_MILLISECONDS;

// Cache structure: { chainCode: { events: [], lastUpdate: timestamp } }
const eventCache = new Map();

// Get event cache events log file path (stores actual events)
const getEventCacheEventsLogPath = ({ chainCode, type }) => {
  return getLogFilePath({ key: LOG_FILES_KEYS.EVENT_CACHE_EVENTS, chainCode, type });
};

// Helper to log to console only (operational logs go to system.log/terminal)
const logEventCache = (message, isError = false) => {
  const logMethod = isError ? console.error : console.log;
  logMethod(message);
};

/**
 * Load cache from log files on startup
 * Reads events from log file (one JSON object per line)
 */
const loadCacheFromDisk = (chainCode, type) => {
  const events = [];
  let lastUpdate = Date.now();

  try {
    const eventsLogPath = getEventCacheEventsLogPath({ chainCode, type });

    if (fs.existsSync(eventsLogPath)) {
      const fileContent = fs.readFileSync(eventsLogPath, 'utf8');
      const lines = fileContent.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          // Parse JSON from each line (format: timestamp JSON_OBJECT)
          // Lines can be: "2024-01-15T10:30:45.123Z {...}" or just "{...}"
          const jsonMatch = line.match(/\{.*\}/);
          if (jsonMatch) {
            const event = JSON.parse(jsonMatch[0]);

            // Only include events within retention period
            const eventAge = Date.now() - (event.cacheAddedAt || event.timestamp || 0);
            if (eventAge < CACHE_RETENTION_MS) {
              events.push(event);
            }
          }
        } catch (error) {
          // Skip invalid lines
          logEventCache(
            `[Event Cache] Skipping invalid event line for ${chainCode} ${type}: ${error.message}`,
            true,
          );
        }
      }

      // Find the most recent event timestamp as lastUpdate
      if (events.length > 0) {
        lastUpdate = Math.max(...events.map((e) => e.cacheAddedAt || e.timestamp || 0));
      }

      logEventCache(
        `[Event Cache] Loaded ${events.length} events for ${chainCode} ${type} from log file`,
      );
    }
  } catch (error) {
    logEventCache(
      `[Event Cache] Error loading cache from log file for ${chainCode} ${type}: ${error.message}`,
      true,
    );
  }

  return { events, lastUpdate };
};

/**
 * Save new events to log file
 * Appends events to log file (one JSON object per line)
 */
const saveEventsToLogFile = (chainCode, type, newEvents) => {
  if (!newEvents || newEvents.length === 0) {
    return;
  }

  try {
    const eventsLogPath = getEventCacheEventsLogPath({ chainCode, type });

    // Append each new event as a JSON line
    for (const event of newEvents) {
      // Convert BigInt values to strings using existing utility function
      // stringifyWithBigInt converts to JSON string, then parse back to object without BigInt
      const eventWithoutBigInt = JSON.parse(stringifyWithBigInt(event));

      addLogMessage({
        filePath: eventsLogPath,
        message: eventWithoutBigInt, // Now safe for JSON.stringify
        addTimestamp: true,
      });
    }
  } catch (error) {
    logEventCache(
      `[Event Cache] Error saving events to log file for ${chainCode} ${type}: ${error.message}`,
      true,
    );
  }
};

/**
 * Clean old events from log file (older than retention period)
 */
const cleanOldEventsFromLogFile = (chainCode, type) => {
  try {
    const eventsLogPath = getEventCacheEventsLogPath({ chainCode, type });

    if (!fs.existsSync(eventsLogPath)) {
      return;
    }

    const fileContent = fs.readFileSync(eventsLogPath, 'utf8');
    const lines = fileContent.split('\n').filter((line) => line.trim());
    const now = Date.now();
    const validLines = [];

    for (const line of lines) {
      try {
        const jsonMatch = line.match(/\{.*\}/);
        if (jsonMatch) {
          const event = JSON.parse(jsonMatch[0]);
          const eventAge = now - (event.cacheAddedAt || event.timestamp || 0);

          // Keep events within retention period
          if (eventAge < CACHE_RETENTION_MS) {
            validLines.push(line);
          }
        } else {
          // Keep non-JSON lines (shouldn't happen, but be safe)
          validLines.push(line);
        }
      } catch {
        // Keep lines that can't be parsed (might be important)
        validLines.push(line);
      }
    }

    // Rewrite file with only valid events
    if (validLines.length !== lines.length) {
      fs.writeFileSync(eventsLogPath, validLines.join('\n') + '\n', 'utf8');
      logEventCache(
        `[Event Cache] Cleaned ${lines.length - validLines.length} old events from ${chainCode} ${type} log file`,
      );
    }
  } catch (error) {
    logEventCache(
      `[Event Cache] Error cleaning old events from log file for ${chainCode} ${type}: ${error.message}`,
      true,
    );
  }
};

/**
 * Get cached events for a chain
 * @param {string} chainCode - Chain code (e.g., 'ETH', 'POL', 'BASE')
 * @param {string} type - Action type ('tokens' or 'nfts')
 * @param {string} eventType - Optional event type to filter (e.g., 'unwrapped', 'wrapped', 'consensus_activity')
 * @param {number} fromTimestamp - Optional: Only return events after this timestamp
 * @param {number} toTimestamp - Optional: Only return events before this timestamp
 * @returns {Array} Array of events
 */
export const getCachedEvents = ({
  chainCode,
  type,
  eventType = null,
  fromTimestamp = null,
  toTimestamp = null,
}) => {
  const cacheKey = `${chainCode}-${type}`;
  const cache = eventCache.get(cacheKey);

  if (!cache || !cache.events) {
    return [];
  }

  let events = [...cache.events]; // Copy to avoid mutations

  // Filter by event type if specified
  if (eventType) {
    events = events.filter((event) => event.event === eventType);
  }

  // Filter by timestamp range if specified
  if (fromTimestamp || toTimestamp) {
    events = events.filter((event) => {
      const eventTime = event.timestamp || 0;
      if (fromTimestamp && eventTime < fromTimestamp) return false;
      if (toTimestamp && eventTime > toTimestamp) return false;
      return true;
    });
  }

  return events;
};

/**
 * Get cache statistics
 */
export const getCacheStats = ({ chainCode, type }) => {
  const cacheKey = `${chainCode}-${type}`;
  const cache = eventCache.get(cacheKey);

  if (!cache) {
    return { exists: false };
  }

  return {
    exists: true,
    eventCount: cache.events.length,
    lastUpdate: cache.lastUpdate,
    age: Date.now() - cache.lastUpdate,
    oldestEvent:
      cache.events.length > 0
        ? Math.min(...cache.events.map((e) => e.timestamp || 0))
        : null,
    newestEvent:
      cache.events.length > 0
        ? Math.max(...cache.events.map((e) => e.timestamp || 0))
        : null,
  };
};

/**
 * Fetch events for a chain and update cache
 */
const updateEventCache = async ({ chain, type }) => {
  const { blocksRangeLimit, blocksOffset = 0, contractAddress, chainParams } = chain;
  const { chainCode } = chainParams || {};
  const cacheKey = `${chainCode}-${type}`;
  const logPrefix = `[Event Cache ${chainCode} ${type}] -->`;

  try {
    // Get or initialize cache
    let cache = eventCache.get(cacheKey);
    if (!cache) {
      cache = loadCacheFromDisk(chainCode, type);
      eventCache.set(cacheKey, cache);
    }

    // Get contract instance
    const contract = Web3Service.getWeb3Contract({
      type,
      chainCode,
      contractAddress,
    });

    const web3ChainInstance = Web3Service.getWe3Instance({ chainCode });

    // Get current block range
    const chainBlockNumber = await web3ChainInstance.eth.getBlockNumber();
    const lastInChainBlockNumber = new MathOp(parseInt(chainBlockNumber))
      .sub(blocksOffset)
      .toNumber();

    // Get last processed block
    let lastProcessedBlockNumber;
    try {
      lastProcessedBlockNumber = getLastProcessedBlockNumber({ chainCode });
    } catch (error) {
      logEventCache(`${logPrefix} error: ${error}`);
      logEventCache(
        `${logPrefix} Block number file not found, starting from current: ${lastInChainBlockNumber}`,
      );
      lastProcessedBlockNumber = lastInChainBlockNumber;
      updateBlockNumber({ chainCode, blockNumber: lastProcessedBlockNumber.toString() });
    }

    // Validate block number
    if (
      isNaN(lastProcessedBlockNumber) ||
      lastProcessedBlockNumber < 0 ||
      new MathOp(lastProcessedBlockNumber).gt(lastInChainBlockNumber)
    ) {
      logEventCache(
        `${logPrefix} Invalid block number, resetting to: ${lastInChainBlockNumber}`,
      );
      lastProcessedBlockNumber = lastInChainBlockNumber;
      updateBlockNumber({ chainCode, blockNumber: lastProcessedBlockNumber.toString() });
    }

    const fromBlockNumber = new MathOp(lastProcessedBlockNumber).add(1).toNumber();

    // Skip if no new blocks
    if (fromBlockNumber > lastInChainBlockNumber) {
      logEventCache(`${logPrefix} No new blocks (at block ${lastInChainBlockNumber})`);
      return;
    }

    logEventCache(
      `${logPrefix} Fetching events from block ${fromBlockNumber} to ${lastInChainBlockNumber}`,
    );

    // Determine block range to fetch
    const maxAllowedBlockNumber = new MathOp(fromBlockNumber)
      .add(blocksRangeLimit)
      .sub(1)
      .toNumber();

    const toBlockNumber = new MathOp(maxAllowedBlockNumber).gt(lastInChainBlockNumber)
      ? lastInChainBlockNumber
      : maxAllowedBlockNumber;

    // Fetch ALL events at once (not separated by type)
    const fetchEvents = async (start, end) => {
      try {
        return await globalRequestQueue.enqueue(
          async () => {
            logEventCache(
              `${logPrefix} Fetching ALL events from block ${start} to ${end}...`,
            );
            return await contract.getPastEvents('allEvents', {
              fromBlock: start,
              toBlock: end,
            });
          },
          { logPrefix, from: start, to: end },
        );
      } catch (err) {
        const msg = (err && err.message) || '';
        const isRangeError =
          (err && err.statusCode === 400) || msg.includes('Exceeded maximum block range');
        if (!isRangeError) throw err;

        // If range error, split into smaller chunks
        logEventCache(
          `${logPrefix} Range error, splitting into ${MORALIS_SAFE_BLOCKS_PER_QUERY}-block chunks`,
        );
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

    // Use smart chunking based on provider
    const windows = splitRangeByProvider({
      chainCode,
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      preferChunk: toBlockNumber - fromBlockNumber + 1,
      moralisMax: MORALIS_SAFE_BLOCKS_PER_QUERY,
    });

    const newEvents = [];
    for (const w of windows) {
      const part = await fetchEvents(w.from, w.to);
      if (part && part.length) {
        // Add timestamp to each event for cache filtering
        part.forEach((event) => {
          event.timestamp = Date.now();
          event.cacheAddedAt = Date.now();
        });
        newEvents.push(...part);
      }
    }

    logEventCache(`${logPrefix} Fetched ${newEvents.length} new events`);

    // Update block number
    updateBlockNumber({
      chainCode,
      blockNumber: toBlockNumber.toString(),
    });

    // Save new events to log file
    if (newEvents.length > 0) {
      saveEventsToLogFile(chainCode, type, newEvents);
    }

    // Add new events to cache
    cache.events.push(...newEvents);

    // Clean up old events from memory (older than 1 hour)
    const now = Date.now();
    const beforeCleanup = cache.events.length;

    // Filter out old events
    const validEvents = cache.events.filter((event) => {
      const eventAge = now - (event.cacheAddedAt || event.timestamp || 0);
      return eventAge < CACHE_RETENTION_MS;
    });

    // Explicitly clear old array and replace with filtered one (helps GC)
    cache.events.length = 0;
    cache.events.push(...validEvents);

    const afterCleanup = cache.events.length;

    // Clean up old events from log file
    cleanOldEventsFromLogFile(chainCode, type);

    if (beforeCleanup > afterCleanup) {
      logEventCache(
        `${logPrefix} Cleaned up ${beforeCleanup - afterCleanup} old events from memory (older than 1 hour)`,
      );
    }

    // Remove cache entry if it's empty and stale (older than retention period)
    if (cache.events.length === 0 && now - cache.lastUpdate > CACHE_RETENTION_MS) {
      eventCache.delete(cacheKey);
      logEventCache(`${logPrefix} Removed empty cache entry for ${chainCode} ${type}`);
    }

    // Update cache metadata
    cache.lastUpdate = now;

    logEventCache(
      `${logPrefix} Cache updated: ${cache.events.length} total events in cache`,
    );
  } catch (error) {
    logEventCache(`${logPrefix} Error updating cache: ${error.message}`, true);
    handleServerError(error, `Event Cache ${chainCode} ${type}`);
  }
};

/**
 * Clean up stale cache entries (removes entries for chains that no longer exist or are empty)
 */
const cleanupStaleCacheEntries = () => {
  const now = Date.now();
  const validCacheKeys = new Set();

  // Build set of valid cache keys from current configuration
  for (const [type, chains] of Object.entries(supportedChains)) {
    for (const chain of chains) {
      const { chainParams } = chain;
      const { chainCode } = chainParams || {};
      if (chainCode) {
        validCacheKeys.add(`${chainCode}-${type}`);
      }
    }
  }

  // Remove cache entries that are no longer in configuration or are stale
  let removedCount = 0;
  for (const [cacheKey, cache] of eventCache.entries()) {
    const isStale = now - cache.lastUpdate > CACHE_RETENTION_MS;
    const isEmpty = !cache.events || cache.events.length === 0;
    const notInConfig = !validCacheKeys.has(cacheKey);

    if ((isStale && isEmpty) || notInConfig) {
      eventCache.delete(cacheKey);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    logEventCache(`[Event Cache] Cleaned up ${removedCount} stale cache entries`);
  }
};

/**
 * Main event cache service
 * Runs every minute to fetch and cache events from all chains
 */
export const runEventCacheService = async () => {
  const logPrefix = '[Event Cache Service] -->';

  try {
    logEventCache(`${logPrefix} Starting event cache update...`);

    // Clean up stale cache entries first (runs every cycle)
    cleanupStaleCacheEntries();

    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        const { chainParams } = chain;
        const { chainCode } = chainParams || {};

        try {
          await updateEventCache({ chain, type });
        } catch (error) {
          logEventCache(
            `${logPrefix} Error updating cache for ${chainCode} ${type}: ${error.message}`,
            true,
          );
          // Continue with other chains even if one fails
        }
      }
    }

    // Print cache statistics
    logEventCache(`${logPrefix} Cache update complete. Statistics:`);
    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        const { chainParams } = chain;
        const { chainCode } = chainParams || {};
        const stats = getCacheStats({ chainCode, type });

        if (stats.exists) {
          logEventCache(
            `${logPrefix}   ${chainCode} ${type}: ${stats.eventCount} events, ` +
              `last update ${Math.round(stats.age / 1000)}s ago`,
          );
        }
      }
    }

    // Log total memory usage
    const totalEvents = Array.from(eventCache.values()).reduce(
      (sum, cache) => sum + (cache.events?.length || 0),
      0,
    );
    logEventCache(
      `${logPrefix} Total events in memory cache: ${totalEvents} across ${eventCache.size} chain/type combinations`,
    );
  } catch (error) {
    logEventCache(`${logPrefix} Error in event cache service: ${error.message}`, true);
    handleServerError(error, 'Event Cache Service');
  }
};

/**
 * Initialize event cache service
 * Load existing caches from disk on startup
 */
export const initializeEventCache = () => {
  logEventCache('[Event Cache] Initializing event cache service...');

  for (const [type, chains] of Object.entries(supportedChains)) {
    for (const chain of chains) {
      const { chainParams } = chain;
      const { chainCode } = chainParams || {};
      const cacheKey = `${chainCode}-${type}`;

      const cache = loadCacheFromDisk(chainCode, type);
      eventCache.set(cacheKey, cache);

      logEventCache(
        `[Event Cache] Initialized cache for ${chainCode} ${type}: ${cache.events.length} events`,
      );
    }
  }

  logEventCache('[Event Cache] Event cache service initialized');
};
