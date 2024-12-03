import config from '../../config/config.js';
import { MINUTE_IN_MILLISECONDS } from '../constants/general.js';

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

export const createRateLimiter = ({ maxRequestsPerTime, resetTime }) => {
  let currentRequestCount = 0;
  const requestQueue = [];

  // Reset the counter every specified time
  const resetInterval = () => {
    setInterval(() => {
      currentRequestCount = 0;
      processQueue();
    }, resetTime);
  };

  // Process the queued requests
  const processQueue = () => {
    while (requestQueue.length > 0 && currentRequestCount < maxRequestsPerTime) {
      const { resolve } = requestQueue.shift();
      currentRequestCount++;
      resolve();
    }
  };

  // Schedule requests based on the limiter
  const scheduleRequest = async () => {
    if (currentRequestCount < maxRequestsPerTime) {
      currentRequestCount++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      requestQueue.push({ resolve });
    });
  };

  // Initialize the rate limiter
  resetInterval();

  return {
    scheduleRequest,
  };
};

export const rateLimiterFor1000Rpm = createRateLimiter({
  maxRequestsPerTime: config.SERVER_RATE_LIMITER_COUNT,
  resetTime: MINUTE_IN_MILLISECONDS,
});

export const convertTimestampIntoMs = (timestamp) => {
  const timestampNumber = Number(timestamp);

  if (!isNaN(timestampNumber)) {
    // If it's a valid numeric timestamp (seconds or milliseconds)
    if (timestampNumber.toString().length === 13) {
      // It's in milliseconds
      return timestampNumber;
    } else {
      // It's in seconds, convert to milliseconds
      return timestampNumber * 1000;
    }
  }

  // If it's neither a valid timestamp nor a valid Date string
  throw new Error('Invalid input: Unable to convert timestamp into milliseconds.');
};
