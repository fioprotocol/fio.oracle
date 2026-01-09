import config from '../../config/config.js';

const {
  oracleCache,
  jobTimeouts: { JOB_LOCK_TTL_SECONDS },
} = config;

/**
 * Generate a generic cache key for chain-specific jobs
 * @param {string} actionName - The action name (use ACTIONS constants)
 * @param {string} chainCode - The chain code (e.g., 'ETH', 'POLYGON', 'BASE')
 * @param {string} type - The type of action (use ACTION_TYPES constants)
 * @param {string} jobType - Optional job type suffix (e.g., 'EventDetection', 'FioTx')
 * @returns {string} The cache key
 */
export const getOracleCacheKey = ({ actionName, chainCode, type, jobType }) => {
  const suffix = jobType ? jobType : '';
  const chain = chainCode || '';
  const actionType = type || '';
  return `is${actionName}On${chain}${actionType}${suffix}JobExecuting`;
};

/**
 * Try to acquire a job lock with TTL.
 * @param {string} cacheKey - The cache key for the job lock
 * @param {string} logPrefix - Optional log prefix for logging
 * @returns {boolean} True if lock was acquired, false if job is already running
 */
export const acquireJobLock = (cacheKey, logPrefix = '') => {
  if (oracleCache.get(cacheKey)) {
    if (logPrefix) {
      console.log(`${logPrefix} Job is already running`);
    }
    return false;
  }

  // Set with TTL (in seconds) - this ensures the lock auto-expires
  // if the job crashes or hangs without properly releasing
  oracleCache.set(cacheKey, true, JOB_LOCK_TTL_SECONDS);
  return true;
};

/**
 * Release a job lock.
 * @param {string} cacheKey - The cache key for the job lock
 */
export const releaseJobLock = (cacheKey) => {
  oracleCache.set(cacheKey, false, 0);
};

/**
 * Refresh a job lock TTL for long-running jobs.
 * Call this periodically during long operations to prevent the lock from expiring.
 * @param {string} cacheKey - The cache key for the job lock
 */
export const refreshJobLock = (cacheKey) => {
  // Only refresh if the lock is currently held (value is true)
  if (oracleCache.get(cacheKey) === true) {
    oracleCache.set(cacheKey, true, JOB_LOCK_TTL_SECONDS);
  }
};

/**
 * Check if a job lock is currently held.
 * @param {string} cacheKey - The cache key for the job lock
 * @returns {boolean} True if the lock is held, false otherwise
 */
export const isJobLocked = (cacheKey) => {
  return oracleCache.get(cacheKey) === true;
};
