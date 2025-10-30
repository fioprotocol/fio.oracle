/**
 * Oracle cache keys
 * - FIO-specific keys are kept static
 * - Generic chain keys should be generated using getOracleCacheKey()
 */
export const ORACLE_CACHE_KEYS = {
  // FIO-specific keys (keep as is)
  isUnprocessedWrapActionsExecuting: 'isUnprocessedWrapActionsExecuting',
  isUnprocessedBurnNFTActionsJobExecuting: 'isUnprocessedBurnNFTActionsJobExecuting',
};
