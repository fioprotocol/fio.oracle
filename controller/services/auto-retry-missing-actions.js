import fs from 'fs';

import { getCachedEvents, getCacheStats } from './event-cache.js';
import config from '../../config/config.js';
import {
  ACTIONS,
  ACTION_TYPES,
  CONTRACT_ACTIONS,
  FIO_CONTRACT_ACTIONS,
} from '../constants/chain.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { ALREADY_COMPLETED } from '../constants/transactions.js';
import { getWrapOracleItems, getUnwrapFioActions } from '../utils/auto-retry/fio-data.js';
import { acquireJobLock, releaseJobLock } from '../utils/cron-jobs.js';
import { runUnwrapFioTransaction } from '../utils/fio-chain.js';
import { stringifyWithBigInt } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import { addLogMessage, handleServerError, readLogFile } from '../utils/log-files.js';
import {
  createMemoryCheckpoint,
  logMemoryDelta,
  logArraySize,
  forceGCAndLog,
} from '../utils/memory-logger.js';
import { blockChainTransaction } from '../utils/transactions.js';
import { Web3Service } from '../utils/web3-services.js';

const { supportedChains } = config;

const CACHE_KEY = 'isAutoRetryMissingActionsExecuting';
const EVENT_SIGNER = 'oracle';

const {
  autoRetryMissingActions: {
    MAX_RETRIES,
    RETRY_DELAY_MS,
    TIME_RANGE_START,
    TIME_RANGE_END,
  },
} = config;

/**
 * Safely stringify an object that may contain BigInt values
 * Uses the shared stringifyWithBigInt utility function
 * @param {any} obj - Object to stringify
 * @returns {string} - JSON string with BigInt values converted to strings
 */
const safeStringify = (obj) => {
  try {
    return stringifyWithBigInt(obj);
  } catch {
    // Fallback: return string representation
    return String(obj);
  }
};

/**
 * Check if there are pending transactions for a chain
 * This prevents creating duplicate transactions with the same nonce
 * @param {string} chainCode - The chain code to check
 * @param {string} logPrefix - Logging prefix for context
 * @returns {boolean} - True if should skip retry (has pending), false if should proceed
 */
const shouldSkipDueToPendingTransactions = (chainCode, logPrefix) => {
  try {
    const pendingTxFile = getLogFilePath({
      key: LOG_FILES_KEYS.PENDING_TRANSACTIONS,
      chainCode,
    });

    const pendingContent = readLogFile(pendingTxFile);
    if (pendingContent && pendingContent.trim()) {
      const pendingLines = pendingContent.split('\n').filter((line) => line.trim());
      if (pendingLines.length > 0) {
        console.log(
          `${logPrefix} Found ${pendingLines.length} pending transaction(s) for ${chainCode}. Skipping retry to avoid nonce conflicts.`,
        );
        console.log(
          `${logPrefix} The pending transaction handler will process these. This action will be retried on next missing-actions check if still missing.`,
        );
        return true; // Skip retry, let pending tx handler deal with it
      }
    }
  } catch (pendingCheckError) {
    console.log(
      `${logPrefix} Could not check pending transactions: ${pendingCheckError.message}. Proceeding with caution.`,
    );
  }
  return false; // No pending transactions, safe to proceed
};

/**
 * Read all cached events from log file (not filtered by time range)
 * This checks the complete cache history, not just recent events
 * @param {string} chainCode - Chain code
 * @param {string} type - Action type (tokens or nfts)
 * @returns {Array} Array of all cached events
 */
const getAllCachedEventsFromFile = ({ chainCode, type }) => {
  const events = [];
  try {
    const eventsLogPath = getLogFilePath({
      key: LOG_FILES_KEYS.EVENT_CACHE_EVENTS,
      chainCode,
      type,
    });

    const logPrefix = `[Get All Cached Events From File] ${chainCode} ${type} -->`;

    if (fs.existsSync(eventsLogPath)) {
      const fileContent = fs.readFileSync(eventsLogPath, 'utf8');
      const lines = fileContent.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const jsonMatch = line.match(/\{.*\}/);
          if (jsonMatch) {
            const event = JSON.parse(jsonMatch[0]);
            events.push(event);
          }
        } catch (error) {
          console.log(`${logPrefix} Read lines error: ${error}`);
        }
      }
    }
  } catch (error) {
    // Return empty array if file read fails
    console.log(`${logPrefix} File read error: ${error}`);
  }

  return events;
};

/**
 * Check if wrap action is already complete by checking cached events from files
 * This avoids provider calls by checking the complete cache first
 * @param {Object} params - Parameters object
 * @param {string} params.obtId - Oracle item ID
 * @param {Object} params.oracleItem - Oracle item with pubaddress, amount, nftname
 * @param {Object} params.chain - Chain configuration
 * @param {string} params.type - Action type (tokens or nfts)
 * @param {string} params.logPrefix - Logging prefix
 * @returns {boolean} - True if already complete in cache, false otherwise
 */
const isWrapActionCompleteInCache = ({ obtId, oracleItem, chain, type, logPrefix }) => {
  const { chainCode } = chain.chainParams;
  const { pubaddress, amount, nftname } = oracleItem;

  // Get ALL cached events from file (not filtered by time)
  const allCachedEvents = getAllCachedEventsFromFile({ chainCode, type });

  // Check for consensus_activity events
  const consensusEvents = allCachedEvents.filter(
    (e) => e.event === CONTRACT_ACTIONS.CONSENSUS_ACTIVITY,
  );
  const ourConsensusEvent = consensusEvents.find((event) => {
    const eventData = event.returnValues || {};
    const eventSigner = eventData.signer;
    const eventObtId = eventData.obtid;
    const eventAccount = eventData.account;

    console.log('Event data:', eventData);
    console.log('Event signer:', eventSigner);
    console.log('Event obtId:', eventObtId);
    console.log('Event account:', eventAccount);
    console.log('Chain public key:', chain.publicKey);
    console.log('Event account lower case:', eventAccount.toLowerCase());
    console.log('Chain public key lower case:', chain.publicKey.toLowerCase());
    console.log(
      'Event account equals chain public key:',
      eventAccount.toLowerCase() === chain.publicKey.toLowerCase(),
    );
    console.log();

    return (
      eventSigner === EVENT_SIGNER &&
      eventObtId === obtId &&
      eventAccount &&
      chain.publicKey &&
      eventAccount.toLowerCase() === chain.publicKey.toLowerCase()
    );
  });

  if (ourConsensusEvent) {
    console.log(
      `${logPrefix} Found consensus event in cache for obtId: ${obtId} - already complete`,
    );
    return true;
  }

  // Check for wrapped events
  const wrappedEvents = allCachedEvents.filter(
    (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
  );
  const wrappedEvent = wrappedEvents.find((event) => {
    const eventObtId =
      event && event.returnValues && event.returnValues.obtid
        ? event.returnValues.obtid
        : null;
    const eventAccount =
      event && event.returnValues && event.returnValues.account
        ? event.returnValues.account
        : null;
    const eventAmount =
      event && event.returnValues && event.returnValues.amount
        ? event.returnValues.amount
        : null;
    const eventNftName =
      event && event.returnValues && event.returnValues.domain
        ? event.returnValues.domain
        : null;

    return (
      eventObtId === obtId &&
      (amount ? String(eventAmount) === String(amount) : eventNftName === nftname) &&
      eventAccount &&
      pubaddress &&
      eventAccount.toLowerCase() === pubaddress.toLowerCase()
    );
  });

  if (wrappedEvent) {
    console.log(
      `${logPrefix} Found wrapped event in cache for obtId: ${obtId} - already complete`,
    );
    return true;
  }

  return false;
};

/**
 * Check if a wrap action is already complete on-chain
 * First checks cached files, then falls back to blockchain check if needed
 * This minimizes provider calls by checking cache first
 * @param {Object} params - Parameters object
 * @param {string} params.obtId - Oracle item ID
 * @param {Object} params.oracleItem - Oracle item with pubaddress, amount, nftname
 * @param {Object} params.chain - Chain configuration
 * @param {string} params.type - Action type (tokens or nfts)
 * @param {Object} params.web3Instance - Web3 instance (reused to avoid recreating)
 * @param {Object} params.contract - Contract instance (reused to avoid recreating)
 * @param {string} params.logPrefix - Logging prefix
 * @returns {Promise<boolean>} - True if already complete, false otherwise
 */
const isWrapActionAlreadyComplete = async ({
  obtId,
  oracleItem,
  chain,
  type,
  web3Instance,
  contract,
  logPrefix,
}) => {
  // FIRST: Check cached files (no provider call)
  if (isWrapActionCompleteInCache({ obtId, oracleItem, chain, type, logPrefix })) {
    return true;
  }

  // SECOND: Only if not in cache, check blockchain (provider call)
  const { pubaddress, amount, nftname } = oracleItem;

  try {
    // FIRST: Check if our oracle has already approved this action by checking getApproval
    try {
      const hashInput =
        type === ACTION_TYPES.TOKENS
          ? web3Instance.utils.encodePacked(
              { value: pubaddress, type: 'address' },
              { value: amount, type: 'uint256' },
              { value: obtId, type: 'string' },
            )
          : web3Instance.utils.encodePacked(
              { value: pubaddress, type: 'address' },
              { value: nftname, type: 'string' },
              { value: obtId, type: 'string' },
            );

      const approvalHash = web3Instance.utils.keccak256(hashInput);
      const approvalData = await contract.methods.getApproval(approvalHash).call();
      const approvers = approvalData[3]; // 4th return value is address[] of approvers

      if (approvers && Array.isArray(approvers)) {
        const hasOurApproval = approvers.some(
          (approver) =>
            approver &&
            chain.publicKey &&
            approver.toLowerCase() === chain.publicKey.toLowerCase(),
        );

        if (hasOurApproval) {
          console.log(
            `${logPrefix} Our oracle has already approved obtId: ${obtId} on-chain - skipping`,
          );
          return true;
        }
      }
    } catch (approvalCheckError) {
      console.log(`${logPrefix} Approval check error: ${approvalCheckError.message}`);
      // If getApproval fails, try static call check
      try {
        const contractMethod =
          type === ACTION_TYPES.TOKENS
            ? contract.methods.wrap(pubaddress, amount, obtId)
            : contract.methods.wrapnft(pubaddress, nftname, obtId);

        await contractMethod.call({ from: chain.publicKey });
        // If static call succeeds, action is not complete yet
      } catch (staticCallError) {
        // Check if error indicates already complete
        const errorMsg = (staticCallError.message || '').toLowerCase();
        const errorReason = (staticCallError.reason || '').toLowerCase();
        const fullErrorString = safeStringify(staticCallError).toLowerCase();

        if (
          errorMsg.includes(ALREADY_COMPLETED) ||
          errorReason.includes(ALREADY_COMPLETED) ||
          fullErrorString.includes(ALREADY_COMPLETED)
        ) {
          console.log(
            `${logPrefix} Wrap already complete on-chain for obtId: ${obtId} (detected via static call) - skipping`,
          );
          return true;
        }
      }
    }
  } catch (blockchainCheckError) {
    // If blockchain check fails, return false to proceed with flagging as missing
    // This ensures we don't miss actions due to temporary blockchain connectivity issues
    console.log(
      `${logPrefix} Could not verify on-chain status for obtId: ${obtId} (${blockchainCheckError.message}), will flag as missing`,
    );
  }

  return false;
};

/**
 * Find missing wrap actions
 * Wrap: FIO chain -> Other chains
 * Checks both consensus_activity (our oracle's submission) and wrapped (final result)
 * Checks ALL cached events from files (not just time-filtered) to minimize provider calls
 */
const findMissingWrapActions = ({
  fioWrapItems,
  consensusEvents,
  wrappedEvents,
  chain,
  type,
}) => {
  const { chainCode } = chain.chainParams;
  const logPrefix = `Auto-Retry Missing Actions, Find Missing Wrap ${chainCode} -->`;
  const missing = [];

  console.log(
    `${logPrefix} Checking ${fioWrapItems.length} FIO wrap oracle items against ${consensusEvents.length} consensus + ${wrappedEvents.length} wrapped events (time-filtered cache)`,
  );

  // Get ALL cached events from files (not filtered by time range)
  const allCachedEvents = getAllCachedEventsFromFile({ chainCode, type });
  const allConsensusEvents = allCachedEvents.filter(
    (e) => e.event === CONTRACT_ACTIONS.CONSENSUS_ACTIVITY,
  );
  const allWrappedEvents = allCachedEvents.filter(
    (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
  );

  console.log(
    `${logPrefix} Also checking ${allConsensusEvents.length} consensus + ${allWrappedEvents.length} wrapped events from complete cache files`,
  );

  for (const oracleItem of fioWrapItems) {
    const { id, chaincode, pubaddress, amount, nftname } = oracleItem;

    // Skip if not for this chain
    if (chaincode !== chainCode) {
      continue;
    }

    // The oracle item id IS the obtId used in the contract
    const obtId = String(id);

    // FIRST: Check time-filtered cache (fast check)
    const ourConsensusEvent = consensusEvents.find((event) => {
      const eventData = event.returnValues || {};
      const eventSigner = eventData.signer;
      const eventObtId = eventData.obtid;
      const eventAccount = eventData.account;

      return (
        eventSigner === EVENT_SIGNER &&
        eventObtId === obtId &&
        eventAccount &&
        chain.publicKey &&
        eventAccount.toLowerCase() === chain.publicKey.toLowerCase()
      );
    });

    if (ourConsensusEvent) {
      console.log(
        `${logPrefix} Our oracle already submitted consensus for obtId: ${obtId} (in time-filtered cache), skipping`,
      );
      continue;
    }

    const wrappedEvent = wrappedEvents.find((event) => {
      const eventObtId = event.returnValues.obtid;
      const eventAccount = event.returnValues.account;
      const eventAmount = event.returnValues.amount;
      const eventNftName = event.returnValues.domain;

      return (
        eventObtId === obtId &&
        (amount ? String(eventAmount) === String(amount) : eventNftName === nftname) &&
        eventAccount &&
        pubaddress &&
        eventAccount.toLowerCase() === pubaddress.toLowerCase()
      );
    });

    if (wrappedEvent) {
      console.log(
        `${logPrefix} Wrap already completed for obtId: ${obtId} (in time-filtered cache), skipping`,
      );
      continue;
    }

    // SECOND: Check ALL cached events from files (complete history, not just recent)
    const ourConsensusEventAll = allConsensusEvents.find((event) => {
      const eventData = event.returnValues || {};
      const eventSigner = eventData.signer;
      const eventObtId = eventData.obtid;
      const eventAccount = eventData.account;

      return (
        eventSigner === EVENT_SIGNER &&
        eventObtId === obtId &&
        eventAccount &&
        chain.publicKey &&
        eventAccount.toLowerCase() === chain.publicKey.toLowerCase()
      );
    });

    if (ourConsensusEventAll) {
      console.log(
        `${logPrefix} Our oracle already submitted consensus for obtId: ${obtId} (in complete cache), skipping`,
      );
      continue;
    }

    const wrappedEventAll = allWrappedEvents.find((event) => {
      const eventObtId =
        event && event.returnValues && event.returnValues.obtid
          ? event.returnValues.obtid
          : null;
      const eventAccount =
        event && event.returnValues && event.returnValues.account
          ? event.returnValues.account
          : null;
      const eventAmount =
        event && event.returnValues && event.returnValues.amount
          ? event.returnValues.amount
          : null;
      const eventNftName =
        event && event.returnValues && event.returnValues.domain
          ? event.returnValues.domain
          : null;

      return (
        eventObtId === obtId &&
        (amount ? String(eventAmount) === String(amount) : eventNftName === nftname) &&
        eventAccount &&
        pubaddress &&
        eventAccount.toLowerCase() === pubaddress.toLowerCase()
      );
    });

    if (wrappedEventAll) {
      console.log(
        `${logPrefix} Wrap already completed for obtId: ${obtId} (in complete cache), skipping`,
      );
      continue;
    }

    // Neither consensus nor wrapped event found in any cache - flag as potentially missing
    // Blockchain verification happens in executeMissingWrapAction (checks cache first, then provider)
    console.log(
      `${logPrefix} Potentially missing wrap action for obtId: ${obtId}, pubaddress: ${pubaddress}`,
    );
    missing.push({
      obtId,
      oracleItem,
      chain,
      type,
    });
  }

  console.log(`${logPrefix} Found ${missing.length} potentially missing wrap actions`);
  return missing;
};

/**
 * Find missing unwrap actions
 * Unwrap: Other chains -> FIO chain
 */
const findMissingUnwrapActions = ({ fioUnwrapActions, unwrappedEvents, chain, type }) => {
  const { chainCode } = chain.chainParams;
  const logPrefix = `Auto-Retry Missing Actions, Find Missing Unwrap ${chainCode} -->`;
  const missing = [];

  console.log(
    `${logPrefix} Checking ${unwrappedEvents.length} unwrapped events against ${fioUnwrapActions.length} FIO unwrap actions`,
  );

  for (const chainEvent of unwrappedEvents) {
    const txHash = chainEvent.transactionHash;
    const eventData = chainEvent.returnValues || {};
    const eventFioAddress = eventData.fioaddress;
    const eventAmount = eventData.amount;
    const eventDomain = eventData.domain;

    // Look for corresponding unwrap action on FIO chain
    const fioAction = fioUnwrapActions.find((action) => {
      const actionData = action.act && action.act.data ? action.act.data : {};
      const actionObtId = actionData.obt_id || actionData.obtid;
      const actionFioAddress = actionData.fio_address;
      const actionAmount = actionData.amount;
      const actionDomain = actionData.domain;

      return (
        actionObtId === txHash &&
        (eventAmount
          ? String(actionAmount) === String(eventAmount)
          : actionDomain === eventDomain) &&
        (!eventFioAddress || !actionFioAddress || eventFioAddress === actionFioAddress)
      );
    });

    if (!fioAction) {
      console.log(
        `${logPrefix} Missing unwrap action for txHash: ${txHash}, fioaddress: ${eventFioAddress}`,
      );
      missing.push({
        txHash,
        chainEvent,
        chain,
        type,
      });
    }
  }

  console.log(`${logPrefix} Found ${missing.length} missing unwrap actions`);
  return missing;
};

/**
 * Execute missing wrap action with retry mechanism
 */
const executeMissingWrapAction = async ({ obtId, oracleItem, chain, type }) => {
  const { chainCode } = chain.chainParams;
  const logPrefix = `Auto-Retry Missing Actions, Execute Wrap ${chainCode}, obtId: ${obtId} -->`;

  const { amount, nftname, pubaddress } = oracleItem;

  console.log(`${logPrefix} Attempting to execute missing wrap action`);

  // Pre-check: Verify if this action is already complete BEFORE making provider calls
  // This prevents unnecessary gas estimation calls and false-positive missing actions
  try {
    const web3Instance = Web3Service.getWe3Instance({ chainCode });
    const contract = await Web3Service.getWeb3Contract({
      type,
      chainCode,
      contractAddress: chain.contractAddress,
    });

    const isAlreadyComplete = await isWrapActionAlreadyComplete({
      obtId,
      oracleItem,
      chain,
      type,
      web3Instance,
      contract,
      logPrefix,
    });

    if (isAlreadyComplete) {
      console.log(
        `${logPrefix} Pre-check detected action already complete - skipping execution`,
      );
      return true; // Already complete, consider it a success
    }

    console.log(`${logPrefix} Pre-check passed, action is not yet complete`);
  } catch (preCheckError) {
    // If pre-check fails, log but proceed with execution
    // This ensures we don't miss actions due to temporary blockchain connectivity issues
    console.log(
      `${logPrefix} Pre-check inconclusive (${preCheckError.message}), proceeding with execution`,
    );
  }

  // Check if there are pending transactions for this chain before attempting retry
  // This prevents creating duplicate transactions with same nonce
  if (shouldSkipDueToPendingTransactions(chainCode, logPrefix)) {
    return false;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let isSuccess = false;

      const actionName = `${ACTIONS.WRAP} ${type}`;

      await blockChainTransaction({
        action: actionName,
        type,
        chainCode,
        contractActionParams: {
          amount,
          obtId,
          pubaddress,
          nftName: nftname,
        },
        logPrefix,
        shouldThrowError: true,
        handleSuccessedResult: () => {
          isSuccess = true;
          console.log(`${logPrefix} Successfully executed on attempt ${attempt}`);
        },
      });

      if (isSuccess) {
        return true;
      }
    } catch (error) {
      // Check if this is an "already X" error - treat as success
      // Catches: "already complete", "already approved", "already executed", etc.
      const errorMessage = (error.message || '').toLowerCase();
      const errorReason = (error.reason || '').toLowerCase();
      const errorData = (error.data || '').toLowerCase();
      const innerErrorMsg = (
        error && error.innerError && error.innerError.message
          ? error.innerError.message
          : ''
      ).toLowerCase();
      const nestedErrorMsg = (
        error && error.error && error.error.message ? error.error.message : ''
      ).toLowerCase();
      const causeMsg = (
        error && error.cause && error.cause.message ? error.cause.message : ''
      ).toLowerCase();

      // Stringify the entire error to catch deeply nested revert reasons (handles BigInt)
      const fullErrorString = safeStringify(error).toLowerCase();

      const isAlreadyComplete =
        errorMessage.includes(ALREADY_COMPLETED) ||
        errorReason.includes(ALREADY_COMPLETED) ||
        errorData.includes(ALREADY_COMPLETED) ||
        innerErrorMsg.includes(ALREADY_COMPLETED) ||
        nestedErrorMsg.includes(ALREADY_COMPLETED) ||
        causeMsg.includes(ALREADY_COMPLETED) ||
        fullErrorString.includes(ALREADY_COMPLETED);

      if (isAlreadyComplete) {
        console.log(
          `${logPrefix} Action already complete - skipping (already processed)`,
        );
        return true; // Consider this a success - action was already done
      }

      console.error(
        `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} failed:`,
        error.message,
      );

      if (attempt < MAX_RETRIES) {
        console.log(
          `${logPrefix} Waiting ${RETRY_DELAY_MS / SECOND_IN_MILLISECONDS}s before retry...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  console.error(`${logPrefix} Failed after ${MAX_RETRIES} attempts`);
  return false;
};

/**
 * Execute missing unwrap action with retry mechanism
 */
const executeMissingUnwrapAction = async ({ txHash, chainEvent, chain, type }) => {
  const { chainCode } = chain.chainParams;
  const logPrefix = `Auto-Retry Missing Actions, Execute Unwrap ${chainCode}, txHash: ${txHash} -->`;

  const eventData = chainEvent.returnValues || {};
  const fioaddress = eventData.fioaddress;
  const amount = eventData.amount;
  const domain = eventData.domain;

  console.log(`${logPrefix} Attempting to execute missing unwrap action`);

  // Check if there are pending transactions for this chain before attempting retry
  // This prevents creating duplicate transactions with same nonce
  if (shouldSkipDueToPendingTransactions(chainCode, logPrefix)) {
    return false;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const actionName = FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][type];

      const transactionActionData = {
        fio_address: fioaddress,
        obt_id: txHash,
      };

      if (amount) {
        transactionActionData.amount = parseInt(amount);
      } else if (domain) {
        transactionActionData.fio_domain = domain;
      }

      const result = await runUnwrapFioTransaction({
        actionName,
        transactionActionData,
      });

      if (!(result.type || result.error)) {
        console.log(`${logPrefix} Successfully executed on attempt ${attempt}`);
        return true;
      } else {
        console.error(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} returned error:`,
          result,
        );
      }
    } catch (error) {
      // Check if this is an "already X" error - treat as success
      // Catches: "already complete", "already approved", "already executed", etc.
      const errorMessage = (error.message || '').toLowerCase();
      const errorReason = (error.reason || '').toLowerCase();
      const errorData = (error.data || '').toLowerCase();
      const innerErrorMsg = (
        error && error.innerError && error.innerError.message
          ? error.innerError.message
          : ''
      ).toLowerCase();
      const nestedErrorMsg = (
        error && error.error && error.error.message ? error.error.message : ''
      ).toLowerCase();
      const causeMsg = (
        error && error.cause && error.cause.message ? error.cause.message : ''
      ).toLowerCase();

      // Stringify the entire error to catch deeply nested revert reasons (handles BigInt)
      const fullErrorString = safeStringify(error).toLowerCase();

      const isAlreadyComplete =
        errorMessage.includes(ALREADY_COMPLETED) ||
        errorReason.includes(ALREADY_COMPLETED) ||
        errorData.includes(ALREADY_COMPLETED) ||
        innerErrorMsg.includes(ALREADY_COMPLETED) ||
        nestedErrorMsg.includes(ALREADY_COMPLETED) ||
        causeMsg.includes(ALREADY_COMPLETED) ||
        fullErrorString.includes(ALREADY_COMPLETED);

      if (isAlreadyComplete) {
        console.log(
          `${logPrefix} Action already complete - skipping (already processed)`,
        );
        return true; // Consider this a success
      }

      console.error(
        `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} failed:`,
        error.message,
      );
    }

    if (attempt < MAX_RETRIES) {
      console.log(
        `${logPrefix} Waiting ${RETRY_DELAY_MS / SECOND_IN_MILLISECONDS}s before retry...`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  console.error(`${logPrefix} Failed after ${MAX_RETRIES} attempts`);
  return false;
};

/**
 * Main auto-retry function
 */
export const autoRetryMissingActions = async () => {
  const logPrefix = 'Auto-Retry Missing Actions -->';

  if (!acquireJobLock(CACHE_KEY, logPrefix)) {
    return;
  }
  console.log(`${logPrefix} Starting...`);

  // Initialize checkpoint variable for finally block
  let startCheckpoint = null;

  try {
    // Create memory checkpoint at start (inside try block to ensure finally always runs)
    startCheckpoint = createMemoryCheckpoint('Auto-retry start', logPrefix);
    const now = Date.now();
    const beforeTimestamp = now - TIME_RANGE_START; // 15 minutes ago
    const afterTimestamp = now - TIME_RANGE_END; // 1 hour ago

    console.log(
      `${logPrefix} Time range: ${new Date(afterTimestamp).toISOString()} to ${new Date(beforeTimestamp).toISOString()}`,
    );

    // Fetch wrap oracle items from get_table_rows
    const beforeFioFetch = createMemoryCheckpoint('Before fetching FIO data', logPrefix);
    const { wrapTokensItems, wrapDomainsItems } = await getWrapOracleItems({
      afterTimestamp,
      beforeTimestamp,
    });
    logMemoryDelta('After fetching FIO wrap items', beforeFioFetch, logPrefix);
    logArraySize('wrapTokensItems', wrapTokensItems, logPrefix);
    logArraySize('wrapDomainsItems', wrapDomainsItems, logPrefix);

    // Fetch unwrap actions from history API
    const beforeHistoryFetch = createMemoryCheckpoint(
      'Before fetching FIO history',
      logPrefix,
    );
    const { unwrapTokensActions, unwrapDomainsActions } = await getUnwrapFioActions({
      afterTimestamp,
      beforeTimestamp,
    });
    logMemoryDelta('After fetching FIO unwrap actions', beforeHistoryFetch, logPrefix);
    logArraySize('unwrapTokensActions', unwrapTokensActions, logPrefix);
    logArraySize('unwrapDomainsActions', unwrapDomainsActions, logPrefix);

    // Collect all missing actions first
    const allMissingWrapActions = [];
    const allMissingUnwrapActions = [];

    // Process each chain to find missing actions
    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        const { chainCode } = chain.chainParams;
        const chainCheckpoint = createMemoryCheckpoint(
          `Before processing ${chainCode} ${type}`,
          logPrefix,
        );

        // Get cache statistics
        const cacheStats = getCacheStats({ chainCode, type });
        if (cacheStats.exists) {
          console.log(
            `${logPrefix} ${chainCode} ${type} cache: ${cacheStats.eventCount} events, ` +
              `age: ${Math.round(cacheStats.age / 1000)}s`,
          );
        } else {
          console.log(`${logPrefix} ${chainCode} ${type} cache not ready yet`);
        }

        // Calculate time range
        const now = Date.now();
        const beforeTimestamp = now - TIME_RANGE_START;
        const afterTimestamp = now - TIME_RANGE_END;

        // Get all events from cache for the time range
        const allEventsInRange = getCachedEvents({
          chainCode,
          type,
          fromTimestamp: afterTimestamp,
          toTimestamp: beforeTimestamp,
        });

        // Filter by event type
        const consensusEvents = allEventsInRange.filter(
          (e) => e.event === CONTRACT_ACTIONS.CONSENSUS_ACTIVITY,
        );
        const wrappedEvents = allEventsInRange.filter(
          (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
        );
        const unwrappedEvents = allEventsInRange.filter(
          (e) => e.event === CONTRACT_ACTIONS.UNWRAPPED,
        );

        console.log(
          `${logPrefix} ${chainCode} ${type}: ${consensusEvents.length} consensus, ` +
            `${wrappedEvents.length} wrapped, ${unwrappedEvents.length} unwrapped (from cache)`,
        );

        logArraySize(`${chainCode} ${type} consensusEvents`, consensusEvents, logPrefix);
        logArraySize(`${chainCode} ${type} wrappedEvents`, wrappedEvents, logPrefix);
        logArraySize(`${chainCode} ${type} unwrappedEvents`, unwrappedEvents, logPrefix);

        // Find missing wrap actions (using oracle items)
        const fioWrapItems =
          type === ACTION_TYPES.TOKENS
            ? wrapTokensItems
            : type === ACTION_TYPES.NFTS
              ? wrapDomainsItems
              : null;

        if (!fioWrapItems) {
          continue;
        }

        const missingWrapActions = findMissingWrapActions({
          fioWrapItems,
          consensusEvents,
          wrappedEvents,
          chain,
          type,
        });

        allMissingWrapActions.push(...missingWrapActions);

        // Find missing unwrap actions (using history actions)
        const fioUnwrapActions =
          type === ACTION_TYPES.TOKENS ? unwrapTokensActions : unwrapDomainsActions;
        const missingUnwrapActions = findMissingUnwrapActions({
          fioUnwrapActions,
          unwrappedEvents,
          chain,
          type,
        });

        allMissingUnwrapActions.push(...missingUnwrapActions);

        // Clear event arrays to free memory before next chain
        const beforeClear = createMemoryCheckpoint(
          `Before clearing ${chainCode} ${type} arrays`,
          logPrefix,
        );
        consensusEvents.length = 0;
        wrappedEvents.length = 0;
        unwrappedEvents.length = 0;
        logMemoryDelta(
          `After clearing ${chainCode} ${type} arrays`,
          beforeClear,
          logPrefix,
        );

        // Log memory after processing this chain
        logMemoryDelta(`Completed ${chainCode} ${type}`, chainCheckpoint, logPrefix);
      }
    }

    console.log(
      `${logPrefix} Found ${allMissingWrapActions.length} missing wrap actions and ${allMissingUnwrapActions.length} missing unwrap actions`,
    );
    logArraySize('allMissingWrapActions', allMissingWrapActions, logPrefix);
    logArraySize('allMissingUnwrapActions', allMissingUnwrapActions, logPrefix);
    logMemoryDelta('After finding all missing actions', startCheckpoint, logPrefix);

    // Execute all missing wrap actions one by one with 5 second delay
    for (let i = 0; i < allMissingWrapActions.length; i++) {
      const missingWrap = allMissingWrapActions[i];
      const { chainCode } = missingWrap.chain.chainParams;
      const timestamp = new Date().toISOString();

      console.log(
        `${logPrefix} Executing missing wrap action ${i + 1}/${allMissingWrapActions.length}`,
      );

      // Log missing action
      addLogMessage({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.MISSING_ACTIONS }),
        message: {
          timestamp,
          action: ACTIONS.WRAP,
          type: missingWrap.type,
          chainCode,
          obtId: missingWrap.obtId,
          details: {
            id: missingWrap.oracleItem.id,
            amount: missingWrap.oracleItem.amount,
            nftname: missingWrap.oracleItem.nftname,
            pubaddress: missingWrap.oracleItem.pubaddress,
            chaincode: missingWrap.oracleItem.chaincode,
          },
        },
      });

      // Execute the action
      const success = await executeMissingWrapAction(missingWrap);

      if (success) {
        console.log(
          `${logPrefix} Successfully retried wrap action for ${chainCode}, obtId: ${missingWrap.obtId}`,
        );
      } else {
        console.error(
          `${logPrefix} Failed to retry wrap action for ${chainCode}, obtId: ${missingWrap.obtId}`,
        );
      }

      // Wait 5 seconds before next action (except for the last one)
      if (i < allMissingWrapActions.length - 1) {
        console.log(
          `${logPrefix} Waiting ${RETRY_DELAY_MS / SECOND_IN_MILLISECONDS}s before next action...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    // Execute all missing unwrap actions one by one with 5 second delay
    for (let i = 0; i < allMissingUnwrapActions.length; i++) {
      const missingUnwrap = allMissingUnwrapActions[i];
      const { chainCode } = missingUnwrap.chain.chainParams;
      const timestamp = new Date().toISOString();

      console.log(
        `${logPrefix} Executing missing unwrap action ${i + 1}/${allMissingUnwrapActions.length}`,
      );

      // Log missing action (convert BigInt values to strings for JSON serialization)
      const returnValuesWithoutBigInt = JSON.parse(
        safeStringify(missingUnwrap.chainEvent.returnValues),
      );

      addLogMessage({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.MISSING_ACTIONS }),
        message: {
          timestamp,
          action: ACTIONS.UNWRAP,
          type: missingUnwrap.type,
          chainCode,
          txHash: missingUnwrap.txHash,
          details: returnValuesWithoutBigInt,
        },
      });

      // Execute the action
      const success = await executeMissingUnwrapAction(missingUnwrap);

      if (success) {
        console.log(
          `${logPrefix} Successfully retried unwrap action for ${chainCode}, txHash: ${missingUnwrap.txHash}`,
        );
      } else {
        console.error(
          `${logPrefix} Failed to retry unwrap action for ${chainCode}, txHash: ${missingUnwrap.txHash}`,
        );
      }

      // Wait 5 seconds before next action (except for the last one)
      if (i < allMissingUnwrapActions.length - 1) {
        console.log(
          `${logPrefix} Waiting ${RETRY_DELAY_MS / SECOND_IN_MILLISECONDS}s before next action...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    console.log(`${logPrefix} Completed successfully`);
    logMemoryDelta('Before final cleanup', startCheckpoint, logPrefix);

    // Explicitly clear large arrays to help GC
    const beforeArrayCleanup = createMemoryCheckpoint('Before array cleanup', logPrefix);
    allMissingWrapActions.length = 0;
    allMissingUnwrapActions.length = 0;
    wrapTokensItems.length = 0;
    wrapDomainsItems.length = 0;
    unwrapTokensActions.length = 0;
    unwrapDomainsActions.length = 0;
    logMemoryDelta('After array cleanup', beforeArrayCleanup, logPrefix);
  } catch (error) {
    console.error(`${logPrefix} Error:`, error.message);
    handleServerError(error, 'Auto-Retry Missing Actions');
  } finally {
    // Force GC and log results
    forceGCAndLog(logPrefix);

    // Log final memory usage compared to start (only if checkpoint was created)
    if (startCheckpoint) {
      logMemoryDelta('Final memory (end of job)', startCheckpoint, logPrefix);
    }

    releaseJobLock(CACHE_KEY);
  }
};
