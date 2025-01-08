import { SECOND_IN_MILLISECONDS } from './general';

export const NONCE_TOO_LOW_ERROR = 'nonce too low';
export const ALREADY_KNOWN_TRANSACTION = 'already known';
export const LOW_GAS_PRICE = 'was not mined';
export const REVERTED_BY_THE_EVM = 'reverted by the EVM';

export const MAX_RETRY_TRANSACTION_ATTEMPTS = 3;

export const TRANSACTION_DELAY = SECOND_IN_MILLISECONDS * 3; // 3 seconds
