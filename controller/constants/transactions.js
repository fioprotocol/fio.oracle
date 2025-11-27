import { SECOND_IN_MILLISECONDS, MINUTE_IN_MILLISECONDS } from './general.js';

export const NONCE_TOO_LOW_ERROR = 'nonce too low';
export const ALREADY_KNOWN_TRANSACTION = 'already known';
export const LOW_GAS_PRICE = 'was not mined';
export const REVERTED_BY_THE_EVM = 'reverted by the EVM';
export const ALREADY_COMPLETED = 'already'; // More robust: catches any "already X" error
export const TRANSACTION_NOT_FOUND = 'transaction not found';

export const MAX_RETRY_TRANSACTION_ATTEMPTS = 3;

export const TRANSACTION_DELAY = SECOND_IN_MILLISECONDS * 3; // 3 seconds

export const MAX_TRANSACTION_AGE = MINUTE_IN_MILLISECONDS * 3; // 3 minutes

// Network error codes that should be retried
export const NETWORK_ERROR_CODES = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
];

// Network error message patterns (lowercase)
export const NETWORK_ERROR_MESSAGES = [
  'getaddrinfo',
  'eai_again',
  'enotfound',
  'etimedout',
  'econnrefused',
  'econnreset',
  'fetch failed',
  'rate limit',
  'too many requests',
  'network',
  'timeout',
];

// Error message patterns that should NOT trigger fallback (lowercase)
export const NO_FALLBACK_ERROR_MESSAGES = [
  'exceeded maximum block range',
  NONCE_TOO_LOW_ERROR,
  'replacement transaction underpriced',
  ALREADY_KNOWN_TRANSACTION,
  'execution reverted',
  ALREADY_COMPLETED,
];
