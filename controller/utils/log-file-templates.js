import config from '../../config/config.js';

const { mode } = config;

export const LOG_DIRECTORY_PATH_NAME = `controller/api/logs-${mode}/`;

// Log file keys - defined here to avoid circular dependency
export const LOG_FILES_KEYS = {
  CHAIN: 'chain',
  BLOCK_NUMBER: 'blockNumber',
  NONCE: 'nonce',
  PENDING_TRANSACTIONS: 'pendingTransactions',
  WRAP: 'wrap',
  WRAP_ERROR: 'wrap-error',
  UNWRAP: 'unwrap',
  UNWRAP_ERROR: 'unwrap-error',
  ORACLE_ERRORS: 'oracleErrors',
  FIO: 'fio',
  FIO_ORACLE_ITEM_ID: 'fioOracleItemId',
  BURN_NFTS: 'burnNFTs',
  BURN_NFTS_ERROR: 'burnNFTs-error',
};

/**
 * Get log file path by key
 * @param {Object} params - Parameters object
 * @param {string} params.key - Log file key (e.g., 'wrap', 'unwrap', 'nonce', 'blockNumber', etc.)
 * @param {string} params.chainCode - Chain code (e.g., 'ETH', 'POLYGON', 'BASE')
 * @param {string} params.type - Optional type (e.g., 'tokens', 'nfts')
 * @returns {string} Full path to the log file
 */
export const getLogFilePath = ({ key, chainCode = null, type = null } = {}) => {
  const logFiles = {
    // Chain-specific logs (require chainCode)
    [LOG_FILES_KEYS.CHAIN]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}${type}-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.BLOCK_NUMBER]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}block-number-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.NONCE]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}nonce-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.PENDING_TRANSACTIONS]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}pending-transactions-${chainCode}.log`
      : null,

    // Transaction queues (require chainCode)
    [LOG_FILES_KEYS.WRAP]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}wrap-${type}-transactions-queue-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.WRAP_ERROR]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}wrap-${type}-transactions-error-queue-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.UNWRAP]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}unwrap-${type}-transactions-queue-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.UNWRAP_ERROR]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}unwrap-${type}-transactions-error-queue-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.BURN_NFTS]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}burnnfts-transactions-queue-${chainCode}.log`
      : null,
    [LOG_FILES_KEYS.BURN_NFTS_ERROR]: chainCode
      ? `${LOG_DIRECTORY_PATH_NAME}burnnfts-transactions-error-queue-${chainCode}.log`
      : null,

    // Application-wide logs (don't require chainCode)
    [LOG_FILES_KEYS.FIO]: `${LOG_DIRECTORY_PATH_NAME}FIO.log`,
    [LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID]: `${LOG_DIRECTORY_PATH_NAME}fioOracleItemId.log`,
    [LOG_FILES_KEYS.ORACLE_ERRORS]: `${LOG_DIRECTORY_PATH_NAME}Error.log`,
  };

  const filePath = logFiles[key];

  if (!filePath) {
    throw new Error(
      `Unknown log file key: ${key}. Available keys: ${Object.keys(logFiles).join(', ')}`,
    );
  }

  return filePath;
};

export default getLogFilePath;
