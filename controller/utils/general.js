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

      const responseJSON = response ? await response.json() : null;
      console.log(responseJSON);
      throw new Error(
        `HTTP error! status: ${response.status}, response: ${responseJSON ? JSON.stringify(responseJSON, null, 4) : 'N/A'}`,
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

export const formatDateYYYYMMDD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}${month}${day}`;
};
