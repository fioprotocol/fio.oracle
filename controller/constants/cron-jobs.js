/**
 * Oracle cache keys
 * - FIO-specific keys are kept static
 * - Generic chain keys should be generated using getOracleCacheKey()
 */
export const ORACLE_CACHE_KEYS = {
  // FIO-specific keys (keep as is)
  isUnprocessedWrapActionsExecuting: 'isUnprocessedWrapActionsExecuting',
  isUnprocessedBurnNFTActionsJobExecuting: 'isUnprocessedBurnNFTActionsJobExecuting',
  isUnwrapFromOtherChainsToFioChainJobExecuting:
    'isUnwrapFromOtherChainsToFioChainJobExecuting',
};

/**
 * Job types for oracle cache key generation
 * Used to differentiate between different stages of processing for the same action
 */
export const ORACLE_JOB_TYPES = {
  EVENT_DETECTION: 'EventDetection', // For detecting events on-chain
  FIO_TX: 'FioTx', // For processing FIO transactions
};
