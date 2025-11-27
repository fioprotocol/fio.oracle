import config from '../../config/config.js';

const { mode } = config;

export const LOG_DIRECTORY_PATH_NAME = `controller/api/logs-${mode}/`;
export const SYSTEM_LOG_FILE = 'system.log';

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
  FIO_ORACLE_ITEM_ID: 'FIO-oracle-item-id',
  BURN_NFTS: 'burnNFTs',
  BURN_NFTS_ERROR: 'burnNFTs-error',
  MISSING_ACTIONS: 'missingActions',
  SYSTEM: 'system',
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
    [LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID]: `${LOG_DIRECTORY_PATH_NAME}FIO-oracle-item-id.log`,
    [LOG_FILES_KEYS.ORACLE_ERRORS]: `${LOG_DIRECTORY_PATH_NAME}Error.log`,
    [LOG_FILES_KEYS.MISSING_ACTIONS]: `${LOG_DIRECTORY_PATH_NAME}missing-actions.log`,
    [LOG_FILES_KEYS.SYSTEM]: `${LOG_DIRECTORY_PATH_NAME}${SYSTEM_LOG_FILE}`,
  };

  const filePath = logFiles[key];

  if (!filePath) {
    throw new Error(
      `Unknown log file key: ${key}. Available keys: ${Object.keys(logFiles).join(', ')}`,
    );
  }

  return filePath;
};

/**
 * Generate all valid log file names based on supported chains configuration
 * Reuses getLogFilePath to avoid code duplication
 * @param {Object} supportedChains - The supported chains configuration from config
 * @returns {Set<string>} Set of valid log file names (without directory path)
 */
export const getAllValidLogFileNames = (supportedChains) => {
  const validFilePaths = new Set();

  // Add application-wide log files (these don't depend on chains)
  validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.FIO }));
  validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID }));
  validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }));
  validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.MISSING_ACTIONS }));
  validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.SYSTEM }));

  // Add FIO block number file
  validFilePaths.add(
    getLogFilePath({ key: LOG_FILES_KEYS.BLOCK_NUMBER, chainCode: 'FIO' }),
  );

  // Add chain-specific log files
  for (const [type, chains] of Object.entries(supportedChains)) {
    for (const chain of chains) {
      const { chainCode } = chain.chainParams || {};
      if (!chainCode) continue;

      // Chain-specific files
      validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.CHAIN, chainCode, type }));
      validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.BLOCK_NUMBER, chainCode }));
      validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.NONCE, chainCode }));
      validFilePaths.add(
        getLogFilePath({ key: LOG_FILES_KEYS.PENDING_TRANSACTIONS, chainCode }),
      );

      // Transaction queue files
      validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.WRAP, chainCode, type }));
      validFilePaths.add(
        getLogFilePath({ key: LOG_FILES_KEYS.WRAP_ERROR, chainCode, type }),
      );
      validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP, chainCode, type }));
      validFilePaths.add(
        getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP_ERROR, chainCode, type }),
      );

      // Burn NFT files (only for nfts type)
      if (type === 'nfts') {
        validFilePaths.add(getLogFilePath({ key: LOG_FILES_KEYS.BURN_NFTS, chainCode }));
        validFilePaths.add(
          getLogFilePath({ key: LOG_FILES_KEYS.BURN_NFTS_ERROR, chainCode }),
        );
      }
    }
  }

  // Extract just the filenames from the full paths
  const validFileNames = new Set();
  for (const filePath of validFilePaths) {
    // Extract filename from path (everything after the last /)
    const fileName = filePath.split('/').pop();
    validFileNames.add(fileName);
  }

  return validFileNames;
};

export default getLogFilePath;
