export const NON_VALID_ORACLE_ADDRESS =
  'Oracle Address is not valid, pls check .env and contract abi.';

/**
 * FIO transaction errors that should not be retried
 * These are validation/permission errors that won't be fixed by retrying
 */
export const FIO_NON_RETRYABLE_ERRORS = [
  'Not a registered Oracle',
  'Invalid oracle',
  'Oracle not found',
  'Expired Transaction', // Transaction expired, needs to be recreated with new timestamp
  'expired_tx_exception', // Alternative format for expired transaction
];
