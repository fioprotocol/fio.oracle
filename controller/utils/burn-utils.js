import fs from 'fs';

import { getFioNameFromChain, normalizeNftName } from './fio-chain.js';
import { getLogFilePath, LOG_FILES_KEYS } from './log-file-templates.js';
import {
  AUTOMATIC_BURN_PREFIX,
  AUTOMATIC_BURN_PREFIX_LEGACY,
  FIO_ACCOUNT_NAMES,
} from '../constants/chain.js';
import { FIO_NON_RETRYABLE_ERRORS } from '../constants/errors.js';

/**
 * Check if an error string contains any non-retryable error patterns
 * @param {string} errorString - The error string to check
 * @returns {boolean} - True if error should not be retried
 */
export const isNonRetryableError = (errorString) => {
  return FIO_NON_RETRYABLE_ERRORS.some((pattern) => errorString.includes(pattern));
};

/**
 * Gets the legacy (historical) transaction ID format for backward compatibility
 * Current format: {tokenId}AutomaticNFTBurn{name}
 * Legacy format: {tokenId}AutomaticDomainBurn{name}
 * @param {string} transactionId - The transaction ID in current format
 * @returns {string|null} - Legacy format transaction ID or null if not applicable
 */
const getLegacyTransactionId = (transactionId) => {
  if (!transactionId) return null;

  // Only convert current format to legacy format for backward compatibility
  if (transactionId.includes(AUTOMATIC_BURN_PREFIX)) {
    return transactionId.replace(AUTOMATIC_BURN_PREFIX, AUTOMATIC_BURN_PREFIX_LEGACY);
  }
  return null;
};

/**
 * Checks if a transaction ID exists in FIO log file with a successful receipt
 * Also checks legacy transaction ID format for backward compatibility with old logs
 * @param {string} fioLogContent - Content of the FIO log file
 * @param {string} transactionId - The transaction ID (obtId) to check
 * @returns {boolean} - True if transaction exists with a receipt (successful)
 */
const hasSuccessfulTransactionInFioLog = (fioLogContent, transactionId) => {
  if (!fioLogContent || !transactionId) return false;

  // Get legacy transaction ID format for backward compatibility with old logs
  const legacyTransactionId = getLegacyTransactionId(transactionId);

  // Each log entry is a single line with JSON.stringify(message)
  const lines = fioLogContent.split(/\r?\n/);
  return lines.some((line) => {
    // Check both current and legacy transaction ID formats
    const hasTransactionId =
      line.includes(transactionId) ||
      (legacyTransactionId && line.includes(legacyTransactionId));

    if (!hasTransactionId) return false;

    // Check if this line contains receipt (successful transaction)
    // Receipt can be: "receipt": or 'receipt': or just receipt (in various formats)
    const hasReceipt =
      line.includes('"receipt"') ||
      line.includes("'receipt'") ||
      line.includes('"receipt":') ||
      line.includes("'receipt':");

    return hasReceipt;
  });
};

/**
 * Creates a function to check if a burn transaction already exists in log files
 * Reads both FIO log and burn log files once and returns a checker function
 * @param {string} chainCode - Chain code (e.g., 'POL', 'ETH')
 * @param {string} logPrefix - Log prefix for error messages
 * @returns {Function} Function that takes obtId and returns true if transaction exists
 */
export const createBurnRecordChecker = ({ chainCode, logPrefix = '' }) => {
  if (!chainCode) {
    throw new Error(
      `[createBurnRecordChecker] chainCode is required. Received: ${chainCode}`,
    );
  }
  const burnLogFile = getLogFilePath({ key: LOG_FILES_KEYS.BURN_NFTS, chainCode });
  const fioLogFile = getLogFilePath({ key: LOG_FILES_KEYS.FIO });

  const logContents = [];
  if (burnLogFile) {
    try {
      if (fs.existsSync(burnLogFile)) {
        logContents.push(fs.readFileSync(burnLogFile, 'utf8'));
      }
    } catch (error) {
      console.error(
        `${logPrefix} Failed to read execution log ${burnLogFile}: ${error.message}`,
      );
    }
  }

  let fioLogContent = '';
  if (fioLogFile) {
    try {
      if (fs.existsSync(fioLogFile)) {
        fioLogContent = fs.readFileSync(fioLogFile, 'utf8');
      }
    } catch (error) {
      console.error(
        `${logPrefix} Failed to read FIO log file ${fioLogFile}: ${error.message}`,
      );
    }
  }

  return (obtId) => {
    if (!obtId) return false;

    // Get legacy transaction ID format for backward compatibility with old logs
    const legacyObtId = getLegacyTransactionId(obtId);

    // Check burn log file (both current and legacy format)
    const existsInBurnLog = logContents.some(
      (content) =>
        content.includes(obtId) || (legacyObtId && content.includes(legacyObtId)),
    );
    if (existsInBurnLog) return true;

    // Check FIO log file - must have both obtId and receipt (indicating successful transaction)
    return hasSuccessfulTransactionInFioLog(fioLogContent, obtId);
  };
};

export const verifyAndFilterBurnList = async ({
  burnCandidates = [],
  chainCode,
  type,
}) => {
  const logPrefix = `[Burn Verification] ${chainCode || 'UNKNOWN'} ${type || ''}`;

  // Use the reusable helper function to check for existing burn records
  const hasExistingBurnRecord = createBurnRecordChecker({ chainCode, logPrefix });

  const fioNameDecisionCache = new Map();
  const fioNameOccurrences = new Map();
  const duplicateNames = new Set();
  const filtered = [];

  const stats = {
    kept: 0,
    removedOwnedByOracle: 0,
    removedAlreadyBurned: 0,
    anomalies: 0,
  };

  for (const candidate of burnCandidates) {
    const { nftName, tokenId, obtId } = candidate;
    const normalizedName = normalizeNftName(nftName);

    if (!normalizedName) {
      stats.anomalies += 1;
      console.warn(
        `${logPrefix} Skipping candidate with missing FIO name. tokenId=${tokenId}, obtId=${obtId}`,
      );
      continue;
    }

    // Check log files first
    if (hasExistingBurnRecord(obtId)) {
      stats.removedAlreadyBurned += 1;
      console.log(
        `${logPrefix} Removing ${nftName} (tokenId=${tokenId}) because obtId ${obtId} already exists in execution logs.`,
      );
      continue;
    }

    const nameOccurrences = (fioNameOccurrences.get(normalizedName) || 0) + 1;
    fioNameOccurrences.set(normalizedName, nameOccurrences);
    if (nameOccurrences > 1) duplicateNames.add(nftName);

    // Check if we already decided for this FIO name
    let fioNameDecision = fioNameDecisionCache.get(normalizedName);

    if (!fioNameDecision) {
      // Query FIO chain to check if FIO name exists
      const fioName = await getFioNameFromChain({ fioName: nftName });

      // FIO name should be burned if:
      // - FIO name doesn't exist on FIO chain, OR
      // - FIO name exists but owner is not fio.oracle
      const shouldBurnBasedOnFio =
        !fioName || (fioName.account && fioName.account !== FIO_ACCOUNT_NAMES.FIO_ORACLE);

      const fioNameOwner = fioName ? fioName.account : null;

      fioNameDecision = {
        shouldBurnBasedOnFio,
        fioNameOwner,
      };
      fioNameDecisionCache.set(normalizedName, fioNameDecision);

      if (!shouldBurnBasedOnFio) {
        console.log(
          `${logPrefix} Removing ${nftName} (tokenId=${tokenId}) because it still exists on FIO with owner ${fioNameOwner}.`,
        );
      }
    }

    if (!fioNameDecision.shouldBurnBasedOnFio) {
      stats.removedOwnedByOracle += 1;
      continue;
    }

    filtered.push(candidate);
    stats.kept += 1;
  }

  if (duplicateNames.size) {
    console.log(
      `${logPrefix} Detected duplicate FIO names with multiple tokenIds: ${Array.from(
        duplicateNames,
      ).join(', ')}`,
    );
  }

  console.log(
    `${logPrefix} Verification summary -> kept=${stats.kept}, removedOwnedByOracle=${stats.removedOwnedByOracle}, removedAlreadyBurned=${stats.removedAlreadyBurned}, anomalies=${stats.anomalies}.`,
  );

  return filtered;
};
