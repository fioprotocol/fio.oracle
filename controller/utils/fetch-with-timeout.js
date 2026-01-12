import fetch from 'node-fetch';

import config from '../../config/config.js';

// Get default timeout from config (default 60 seconds if not configured)
const DEFAULT_TIMEOUT_MS = (config.app && config.app.FETCH_TIMEOUT_MS) || 60000;

/**
 * Fetch with timeout support.
 * Works like native fetch but adds automatic timeout handling.
 *
 * Usage:
 *   fetchWithTimeout(url, options)
 *
 * Options:
 *   - timeout: timeout in ms (default from config)
 *   - ...all standard fetch options (method, body, headers, etc.)
 *
 * Throws TimeoutError if request takes longer than timeout.
 */
export const fetchWithTimeout = async (url, options = {}) => {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    return response;
  } catch (error) {
    // Handle abort/timeout errors
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeout}ms: ${url}`);
      timeoutError.name = 'TimeoutError';
      timeoutError.isTimeoutError = true;
      timeoutError.url = url;
      timeoutError.timeout = timeout;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export default fetchWithTimeout;
