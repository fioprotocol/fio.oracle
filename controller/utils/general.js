import fetch from 'node-fetch';

import config from '../../config/config.js';
import { MINUTE_IN_MILLISECONDS, SECOND_IN_MILLISECONDS } from '../constants/general.js';

import { handleServerError } from '../utils/log-files.js';

const { DEFAULT_MAX_RETRIES } = config;

const RATE_LIMIT_ERROR = 'RATE_LIMIT';

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

export const fetchWithRateLimit = async ({ url, options = {}, backupUrl = null }) => {
  const maxRetries = DEFAULT_MAX_RETRIES;
  let retries = 0;

  const makeRequest = async ({ targetUrl, isBackupRetry }) => {
    try {
      const response = await fetch(targetUrl, options);

      if (response.ok) return response;

      if (response.status === 429) {
        if (retries > maxRetries) {
          throw new Error(`${RATE_LIMIT_ERROR}: Max retries (${maxRetries}) reached`);
        }

        retries++;
        const backoffDelay =
          retries === maxRetries
            ? MINUTE_IN_MILLISECONDS
            : SECOND_IN_MILLISECONDS * Math.pow(2, retries - 1); // Exponential backoff

        console.log(
          `RATE LIMIT FOR URL: ${targetUrl} ${options ? `OPTIONS: ${JSON.stringify(options)}` : ''}`,
        );
        console.log(`RETRY count: ${retries}, waiting ${backoffDelay}ms`);

        await sleep(backoffDelay);
        return makeRequest({ targetUrl });
      }

      let responseData = null;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        // Handle non-JSON responses (like HTML)
        responseData = await response.text();
      }

      throw new Error(
        `HTTP error! status: ${response.status}, response: ${
          typeof responseData === 'string'
            ? responseData.slice(0, 1000) // Limit to first 1000 characters for readability
            : JSON.stringify(responseData, null, 4)
        }`,
      );
    } catch (error) {
      if (!isBackupRetry && backupUrl) {
        handleServerError(error, 'Fetch server failed');

        retries = 0; // Reset retries count for backup url
        console.log(`RUNING backup server: ${backupUrl}`);

        return makeRequest({ targetUrl: backupUrl, isBackupRetry: true });
      }

      throw error;
    }
  };

  try {
    return await makeRequest({ targetUrl: url });
  } catch (error) {
    handleServerError(error, 'Fetch with rate limit failed');
    throw error;
  }
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
