/**
 * Generate a generic cache key for chain-specific jobs
 * @param {string} actionName - The action name (use ACTIONS constants)
 * @param {string} chainCode - The chain code (e.g., 'ETH', 'POLYGON', 'BASE')
 * @param {string} type - The type of action (use ACTION_TYPES constants)
 * @returns {string} The cache key
 */
export const getOracleCacheKey = ({ actionName, chainCode, type }) => {
  return `is${actionName}On${chainCode}${type}JobExecuting`;
};
