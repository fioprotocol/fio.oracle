import config from '../../config/config.js';
import { ACTIONS, ACTION_TYPES, FIO_CONTRACT_ACTIONS } from '../constants/chain.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { ALREADY_COMPLETED } from '../constants/transactions.js';
import { getChainEvents } from '../utils/auto-retry/evm-data.js';
import { getWrapOracleItems, getUnwrapFioActions } from '../utils/auto-retry/fio-data.js';
import { runUnwrapFioTransaction } from '../utils/fio-chain.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import { addLogMessage, handleServerError, readLogFile } from '../utils/log-files.js';
import { blockChainTransaction } from '../utils/transactions.js';

const { oracleCache, supportedChains } = config;

const CACHE_KEY = 'isAutoRetryMissingActionsExecuting';
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
 * @param {any} obj - Object to stringify
 * @returns {string} - JSON string with BigInt values converted to strings
 */
const safeStringify = (obj) => {
  try {
    return JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
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
 * Find missing wrap actions
 * Wrap: FIO chain -> Other chains
 * Checks both consensus_activity (our oracle's submission) and wrapped (final result)
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
    `${logPrefix} Checking ${fioWrapItems.length} FIO wrap oracle items against ${consensusEvents.length} consensus + ${wrappedEvents.length} wrapped events`,
  );

  for (const oracleItem of fioWrapItems) {
    const { id, chaincode, pubaddress, amount, nftname } = oracleItem;

    // Skip if not for this chain
    if (chaincode !== chainCode) {
      continue;
    }

    // The oracle item id IS the obtId used in the contract
    const obtId = String(id);

    // Check if our oracle already submitted consensus_activity for this
    console.log(`${logPrefix} Checking consensus for obtId: ${obtId}`);
    console.log(`${logPrefix} Oracle public key: ${chain.publicKey}`);
    console.log(`${logPrefix} Total consensus events: ${consensusEvents.length}`);

    const ourConsensusEvent = consensusEvents.find((event) => {
      const eventData = event.returnValues || {};
      const eventSigner = eventData.signer;
      const eventObtId = eventData.obtid;
      const eventAccount = eventData.account;

      // Must be oracle signer with matching obtid and our public key
      return (
        eventSigner === 'oracle' &&
        eventObtId === obtId &&
        eventAccount &&
        chain.publicKey &&
        eventAccount.toLowerCase() === chain.publicKey.toLowerCase()
      );
    });

    if (ourConsensusEvent) {
      console.log(
        `${logPrefix} Our oracle already submitted consensus for obtId: ${obtId}, skipping`,
      );
      continue;
    }

    // Check if wrap is already completed (wrapped event exists)
    const wrappedEvent = wrappedEvents.find((event) => {
      const eventObtId = event.returnValues.obtid;
      const eventAccount = event.returnValues.account; // recipient address
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
      console.log(`${logPrefix} Wrap already completed for obtId: ${obtId}, skipping`);
      continue;
    }

    // Neither consensus from our oracle nor wrapped event found - it's missing
    console.log(
      `${logPrefix} Missing wrap action for obtId: ${obtId}, pubaddress: ${pubaddress}`,
    );
    missing.push({
      obtId,
      oracleItem,
      chain,
      type,
    });
  }

  console.log(`${logPrefix} Found ${missing.length} missing wrap actions`);
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

  // Pre-check: Verify if this action is already complete before attempting execution
  // This prevents unnecessary gas estimation calls and false-positive missing actions
  try {
    const { Web3Service } = await import('../utils/web3-services.js');
    const web3Instance = Web3Service.getWe3Instance({ chainCode });
    const contract = await Web3Service.getWeb3Contract({
      type,
      chainCode,
      contractAddress: chain.contractAddress,
    });

    // FIRST: Check if our oracle has already approved this action by checking getApproval
    try {
      // Compute the hash the same way the contract does
      // For tokens: keccak256(abi.encodePacked(pubaddress, amount, obtId))
      // For NFTs: keccak256(abi.encodePacked(pubaddress, nftname, obtId))
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

      // Check if approval exists and if our public key is in the approvers list
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
            `${logPrefix} Our oracle (${chain.publicKey}) has already approved this action - skipping`,
          );
          return true; // Already approved, consider it a success
        }
      }
    } catch (approvalCheckError) {
      // If getApproval fails, it's OK - might mean approval doesn't exist yet
      console.log(
        `${logPrefix} Could not check approvals (${approvalCheckError.message}), continuing with simulation check`,
      );
    }

    // SECOND: Try to call the wrap function with static call (no gas cost, just simulation)
    // If it reverts with "already X" error, skip execution
    const contractMethod =
      type === ACTION_TYPES.TOKENS
        ? contract.methods.wrap(pubaddress, amount, obtId)
        : contract.methods.wrapnft(pubaddress, nftname, obtId);

    await contractMethod.call({ from: chain.publicKey });
    console.log(`${logPrefix} Pre-check passed, action is not yet complete`);
  } catch (preCheckError) {
    // Extract all possible error message sources from nested error structure
    const errorMsg = (preCheckError.message || '').toLowerCase();
    const errorReason = (preCheckError.reason || '').toLowerCase();
    const errorData = (preCheckError.data || '').toLowerCase();
    const innerErrorMsg = (preCheckError.innerError?.message || '').toLowerCase();
    const nestedErrorMsg = (preCheckError.error?.message || '').toLowerCase();
    const causeMsg = (preCheckError.cause?.message || '').toLowerCase();

    // Stringify the entire error to catch deeply nested revert reasons (handles BigInt)
    const fullErrorString = safeStringify(preCheckError).toLowerCase();

    // Check if any error property contains "already"
    const isAlreadyComplete =
      errorMsg.includes(ALREADY_COMPLETED) ||
      errorReason.includes(ALREADY_COMPLETED) ||
      errorData.includes(ALREADY_COMPLETED) ||
      innerErrorMsg.includes(ALREADY_COMPLETED) ||
      nestedErrorMsg.includes(ALREADY_COMPLETED) ||
      causeMsg.includes(ALREADY_COMPLETED) ||
      fullErrorString.includes(ALREADY_COMPLETED);

    if (isAlreadyComplete) {
      console.log(
        `${logPrefix} Pre-check detected action already complete - skipping execution`,
      );
      return true; // Already complete, consider it a success
    }

    // Other errors during pre-check are OK, proceed with execution
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
      const innerErrorMsg = (error.innerError?.message || '').toLowerCase();
      const nestedErrorMsg = (error.error?.message || '').toLowerCase();
      const causeMsg = (error.cause?.message || '').toLowerCase();

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
        transactionActionData.domain = domain;
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
      const innerErrorMsg = (error.innerError?.message || '').toLowerCase();
      const nestedErrorMsg = (error.error?.message || '').toLowerCase();
      const causeMsg = (error.cause?.message || '').toLowerCase();

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

  if (oracleCache.get(CACHE_KEY)) {
    console.log(`${logPrefix} Job is already running`);
    return;
  }

  oracleCache.set(CACHE_KEY, true, 0);
  console.log(`${logPrefix} Starting...`);

  // Log initial memory usage
  const startMem = process.memoryUsage();
  console.log(
    `${logPrefix} Memory at start: ${Math.round(startMem.heapUsed / 1024 / 1024)}MB / ${Math.round(startMem.heapTotal / 1024 / 1024)}MB`,
  );

  try {
    const now = Date.now();
    const beforeTimestamp = now - TIME_RANGE_START; // 15 minutes ago
    const afterTimestamp = now - TIME_RANGE_END; // 1 hour ago

    console.log(
      `${logPrefix} Time range: ${new Date(afterTimestamp).toISOString()} to ${new Date(beforeTimestamp).toISOString()}`,
    );

    // Fetch wrap oracle items from get_table_rows
    const { wrapTokensItems, wrapDomainsItems } = await getWrapOracleItems({
      afterTimestamp,
      beforeTimestamp,
    });

    // Fetch unwrap actions from history API
    const { unwrapTokensActions, unwrapDomainsActions } = await getUnwrapFioActions({
      afterTimestamp,
      beforeTimestamp,
    });

    // Collect all missing actions first
    const allMissingWrapActions = [];
    const allMissingUnwrapActions = [];

    // Process each chain to find missing actions
    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        const { chainCode } = chain.chainParams;
        console.log(`${logPrefix} Processing ${chainCode} ${type}...`);

        // Fetch all relevant events (consensus_activity, wrapped, unwrapped)
        const { consensusEvents, wrappedEvents, unwrappedEvents } = await getChainEvents({
          chain,
          type,
          timeRangeStart: TIME_RANGE_START,
          timeRangeEnd: TIME_RANGE_END,
        });

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
        // These can be large (thousands of events × ~2KB each)
        consensusEvents.length = 0;
        wrappedEvents.length = 0;
        unwrappedEvents.length = 0;
      }
    }

    console.log(
      `${logPrefix} Found ${allMissingWrapActions.length} missing wrap actions and ${allMissingUnwrapActions.length} missing unwrap actions`,
    );

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
  } catch (error) {
    console.error(`${logPrefix} Error:`, error.message);
    handleServerError(error, 'Auto-Retry Missing Actions');
  } finally {
    // Log final memory usage
    const endMem = process.memoryUsage();
    console.log(
      `${logPrefix} Memory at end: ${Math.round(endMem.heapUsed / 1024 / 1024)}MB / ${Math.round(endMem.heapTotal / 1024 / 1024)}MB`,
    );

    oracleCache.set(CACHE_KEY, false, 0);
  }
};
