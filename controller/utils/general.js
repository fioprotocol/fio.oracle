import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import fetch from 'node-fetch';

import { getLogFilePath, LOG_FILES_KEYS } from './log-file-templates.js';
import logger from './logger.js';
import config from '../../config/config.js';
import { FIO_NON_RETRYABLE_ERRORS } from '../constants/errors.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { handleServerError, addLogMessage } from '../utils/log-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let appVersion = null;

/**
 * Get application version from package.json
 * Cached after first read for performance
 * @returns {string} Application version
 */
export const getAppVersion = () => {
  if (!appVersion) {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
    );
    appVersion = packageJson.version;
  }
  return appVersion;
};

/**
 * Log app version to system.log file and/or console
 * Only writes to file if LOG_TO_FILE is enabled in config
 * @param {Object} params - Parameters object
 * @param {string} params.context - Context message (e.g., "Started successfully in testnet mode", "Sync completed successfully")
 * @param {string} params.logPrefix - Optional log prefix for console messages (default: '[Version]')
 */
export const logAppVersionToSystemLog = async ({ context, logPrefix = '[Version]' }) => {
  try {
    const version = getAppVersion();
    const versionMessage = `App version: ${version} - ${context}`;

    // Only write to file if LOG_TO_FILE is enabled
    const { logging } = config;
    if (logging?.LOG_TO_FILE) {
      addLogMessage({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.SYSTEM }),
        message: versionMessage,
      });
    }

    // Use original console to avoid double logging to file
    // (console.log is intercepted by Logger and would write to file again)
    const originalConsole = logger?.originalConsole || console;
    originalConsole.log(`${logPrefix} ${versionMessage}`);
  } catch (error) {
    console.warn(`${logPrefix} Failed to log version: ${error.message}`);
  }
};

const { DEFAULT_MAX_RETRIES } = config;

/**
 * Check if an error string contains any non-retryable error patterns
 * @param {string} errorString - The error string to check
 * @returns {boolean} - True if error should not be retried
 */
const isNonRetryableError = (errorString) => {
  return FIO_NON_RETRYABLE_ERRORS.some((pattern) => errorString.includes(pattern));
};

export const replaceNewLines = (stringValue, replaceChar = ', ') => {
  return stringValue.replace(/(?:\r\n|\r|\n)/g, replaceChar);
};

export const checkHttpResponseStatus = async (
  response,
  additionalErrorMessage = null,
) => {
  if (response.ok) {
    // response.status >= 200 && response.status < 300
    return response;
  } else {
    if (additionalErrorMessage) console.log(additionalErrorMessage);
    // Clone the response to preserve the original body
    const clonedResponse = response.clone();

    // Consume the cloned response body
    const errorBody = await clonedResponse.text();
    console.log(errorBody);
    throw new Error(errorBody);
  }
};

export const handleBackups = async (callback, isRetry, backupParams) => {
  try {
    if (isRetry && backupParams) return await callback(backupParams);
    return await callback();
  } catch (error) {
    if (backupParams && !isRetry) {
      return await handleBackups(callback, true, backupParams);
    } else {
      throw error;
    }
  }
};

export const sleep = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Fetch with multiple servers and retry logic
 * @param {Array<string>} serverUrls - Array of server URLs to try
 * @param {Function} urlBuilder - Function that takes a baseUrl and returns the full URL
 * @param {Object} options - Fetch options
 * @param {number} maxCycleRetries - Maximum number of times to retry the entire server list (default: 5)
 * @returns {Promise<Response>} - Fetch response
 */
export const fetchWithMultipleServers = async ({
  serverUrls = [],
  urlBuilder,
  options = {},
  maxCycleRetries = 5,
}) => {
  if (!serverUrls || serverUrls.length === 0) {
    throw new Error('No server URLs provided');
  }

  let cycleAttempt = 0;
  const maxRetriesPerServer = DEFAULT_MAX_RETRIES;

  while (cycleAttempt < maxCycleRetries) {
    cycleAttempt++;
    let nonRetryableErrorCount = 0;

    // Try each server in the array
    for (let serverIndex = 0; serverIndex < serverUrls.length; serverIndex++) {
      const baseUrl = serverUrls[serverIndex];
      const targetUrl = urlBuilder ? urlBuilder(baseUrl) : baseUrl;
      let serverRetries = 0;

      console.log(
        `[FIO Server] Cycle ${cycleAttempt}/${maxCycleRetries}, Server ${serverIndex + 1}/${serverUrls.length}: ${baseUrl}`,
      );

      // Try the current server with its own retry logic for rate limits
      while (serverRetries <= maxRetriesPerServer) {
        try {
          const response = await fetch(targetUrl, options);

          if (response.ok) {
            if (cycleAttempt > 1 || serverIndex > 0) {
              console.log(
                `[FIO Server] Success with server ${serverIndex + 1} on cycle ${cycleAttempt}`,
              );
            }
            return response;
          }

          // Handle rate limiting with exponential backoff for the same server
          if (response.status === 429) {
            if (serverRetries < maxRetriesPerServer) {
              serverRetries++;
              const backoffDelay =
                SECOND_IN_MILLISECONDS * Math.pow(2, serverRetries - 1);

              console.log(
                `[FIO Server] Rate limit on server ${serverIndex + 1}, retry ${serverRetries}/${maxRetriesPerServer}, waiting ${backoffDelay}ms`,
              );

              await sleep(backoffDelay);
              continue; // Retry the same server
            } else {
              console.log(
                `[FIO Server] Rate limit max retries reached for server ${serverIndex + 1}, trying next server`,
              );
              break; // Move to next server
            }
          }

          // Handle other HTTP errors
          let responseData = null;
          const contentType = response.headers.get('content-type');

          if (contentType && contentType.includes('application/json')) {
            responseData = await response.json();
          } else {
            responseData = await response.text();
          }

          const errorMessage = `HTTP error! status: ${response.status}, response: ${
            typeof responseData === 'string'
              ? responseData.slice(0, 1000)
              : JSON.stringify(responseData, null, 4)
          }`;

          console.log(`[FIO Server] Error on server ${serverIndex + 1}: ${errorMessage}`);

          // Check if non-retryable error
          if (isNonRetryableError(errorMessage)) {
            nonRetryableErrorCount++;
            console.log(
              `[FIO Server] Non-retryable error detected, skipping to next server`,
            );
            break; // Move to next server
          }

          throw new Error(errorMessage);
        } catch (error) {
          const errorString = error.message || error.toString();

          // Check if non-retryable error
          if (isNonRetryableError(errorString)) {
            nonRetryableErrorCount++;
            console.log(
              `[FIO Server] Non-retryable error on server ${serverIndex + 1}: ${errorString}`,
            );
            break; // Move to next server
          }

          console.log(`[FIO Server] Error on server ${serverIndex + 1}: ${errorString}`);

          // If this was a network error or other exception, try next server
          break;
        }
      }
    }

    // If ALL servers returned non-retryable errors, stop immediately
    if (nonRetryableErrorCount === serverUrls.length) {
      const errorMessage = `All FIO servers returned non-retryable errors (e.g., "Not a registered Oracle"). Please check your configuration.`;
      console.error(`[FIO Server] ${errorMessage}`);
      handleServerError(new Error(errorMessage), 'Fetch with multiple servers failed');
      throw new Error(errorMessage);
    }

    // All servers tried in this cycle, wait before next cycle
    if (cycleAttempt < maxCycleRetries) {
      const cycleBackoffDelay = SECOND_IN_MILLISECONDS * Math.pow(2, cycleAttempt);
      console.log(
        `[FIO Server] All servers failed in cycle ${cycleAttempt}, waiting ${cycleBackoffDelay}ms before retry cycle ${cycleAttempt + 1}`,
      );
      await sleep(cycleBackoffDelay);
    }
  }

  // All cycles exhausted
  const errorMessage = `All FIO servers failed after ${maxCycleRetries} cycles`;
  console.error(`[FIO Server] ${errorMessage}`);
  handleServerError(new Error(errorMessage), 'Fetch with multiple servers failed');
  throw new Error(errorMessage);
};

export const convertTimestampIntoMs = (timestamp) => {
  const timestampNumber = Number(timestamp);

  if (!isNaN(timestampNumber)) {
    // If it's a valid numeric timestamp (seconds or milliseconds)
    if (timestampNumber.toString().length === 13) {
      // It's in milliseconds
      return timestampNumber;
    } else {
      // It's in seconds, convert to milliseconds
      return timestampNumber * SECOND_IN_MILLISECONDS;
    }
  }

  // If it's neither a valid timestamp nor a valid Date string
  throw new Error('Invalid input: Unable to convert timestamp into milliseconds.');
};

export const stringifyWithBigInt = (obj) => {
  return JSON.stringify(obj, (key, value) => {
    // Handle arrays to maintain their structure
    if (Array.isArray(value)) {
      return value;
    }
    // Convert BigInt to string
    if (typeof value === 'bigint') {
      return value.toString();
    }
    // Return all other values as is
    return value;
  });
};

export const withLoadingIndicator = async (promise, message) => {
  console.log(message);
  let dots = -1;
  const loadingInterval = setInterval(() => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    dots = (dots + 1) % 4;
    process.stdout.write(`Loading ${'.'.repeat(dots)}`);
  }, 500);

  try {
    const result = await promise;
    clearInterval(loadingInterval);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write('\n'); // New line after loading dots
    return result;
  } catch (error) {
    clearInterval(loadingInterval);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write('\n');
    throw error;
  }
};

/**
 * Format date as YYYY-MM-DD for folder names
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
export const formatDateForFolder = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
