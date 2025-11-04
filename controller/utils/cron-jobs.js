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
