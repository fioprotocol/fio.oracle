import config from '../../config/config.js';
import {
  ACTIONS,
  ACTION_TYPES,
  FIO_ACCOUNT_NAMES,
  FIO_CONTRACT_ACTIONS,
  CONTRACT_ACTIONS,
} from '../constants/chain.js';
import { SECOND_IN_MILLISECONDS, MINUTE_IN_MILLISECONDS } from '../constants/general.js';
import { estimateBlockRange } from '../utils/chain.js';
import { runUnwrapFioTransaction, getOracleItems } from '../utils/fio-chain.js';
import { fetchWithMultipleServers, convertTimestampIntoMs } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import { addLogMessage, handleServerError } from '../utils/log-files.js';
import { blockChainTransaction } from '../utils/transactions.js';
import { Web3Service } from '../utils/web3-services.js';

const {
  fio: { FIO_SERVER_URL_HISTORY, FIO_HISTORY_HYPERION_OFFSET },
  oracleCache,
  supportedChains,
} = config;

const CACHE_KEY = 'isAutoRetryMissingActionsExecuting';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5 * SECOND_IN_MILLISECONDS; // 5 seconds between retries
const TIME_RANGE_START = 15 * MINUTE_IN_MILLISECONDS; // 15 minutes ago
const TIME_RANGE_END = 60 * MINUTE_IN_MILLISECONDS; // 1 hour ago

/**
 * Fetch wrap oracle items from get_table_rows with time filtering
 * For wrap actions, we need to use get_table_rows as obt_id is the oracle item id
 */
const getWrapOracleItems = async ({ afterTimestamp, beforeTimestamp }) => {
  const logPrefix = 'Auto-Retry Missing Actions, FIO Wrap Oracle Items -->';

  try {
    // Get oracle items starting from 0 (could be any starting point)
    const oracleItems = await getOracleItems({
      logPrefix,
      lowerBound: 0,
    });

    console.log(`${logPrefix} Found ${oracleItems.length} total oracle items`);

    // Filter by timestamp range
    const filteredOracleItems = oracleItems.filter(({ timestamp }) => {
      const timestampMs = convertTimestampIntoMs(timestamp);
      return timestampMs >= afterTimestamp && timestampMs <= beforeTimestamp;
    });

    // Separate by type
    const wrapTokensItems = filteredOracleItems.filter((item) => item.amount);
    const wrapDomainsItems = filteredOracleItems.filter((item) => item.nftname);

    console.log(
      `${logPrefix} In time range - Wrap tokens: ${wrapTokensItems.length}, Wrap domains: ${wrapDomainsItems.length}`,
    );

    return {
      wrapTokensItems,
      wrapDomainsItems,
    };
  } catch (error) {
    console.error(`${logPrefix} Error fetching wrap oracle items:`, error.message);
    return {
      wrapTokensItems: [],
      wrapDomainsItems: [],
    };
  }
};

/**
 * Fetch unwrap actions from history v2 API with time filtering
 * For unwrap actions, we need history API to get the transaction data
 */
const getUnwrapFioActions = async ({ afterTimestamp, beforeTimestamp }) => {
  const logPrefix = 'Auto-Retry Missing Actions, FIO Unwrap Actions -->';

  try {
    const params = {
      account: FIO_ACCOUNT_NAMES.FIO_ORACLE,
      limit: FIO_HISTORY_HYPERION_OFFSET,
      sort: 'desc',
      after: new Date(afterTimestamp).toISOString(),
      before: new Date(beforeTimestamp).toISOString(),
    };

    const queryString = new URLSearchParams(params).toString();

    const response = await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_HISTORY,
      urlBuilder: (baseUrl) => `${baseUrl}v2/history/get_actions?${queryString}`,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const actions = data.actions || [];

    console.log(`${logPrefix} Found ${actions.length} total FIO actions`);

    // Filter only unwrap actions
    const unwrapTokensActions = actions.filter(
      (action) =>
        action.act &&
        action.act.name === FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][ACTION_TYPES.TOKENS],
    );
    const unwrapDomainsActions = actions.filter(
      (action) =>
        action.act &&
        action.act.name === FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][ACTION_TYPES.NFTS],
    );

    console.log(
      `${logPrefix} Unwrap tokens: ${unwrapTokensActions.length}, Unwrap domains: ${unwrapDomainsActions.length}`,
    );

    return {
      unwrapTokensActions,
      unwrapDomainsActions,
    };
  } catch (error) {
    console.error(`${logPrefix} Error fetching unwrap actions:`, error.message);
    return {
      unwrapTokensActions: [],
      unwrapDomainsActions: [],
    };
  }
};

/**
 * Fetch all relevant contract events from other chains within time range
 * Gets consensus_activity, wrapped, and unwrapped events
 */
const getChainEvents = async ({ chain, type, timeRangeStart, timeRangeEnd }) => {
  const { chainParams, infura, contractAddress } = chain;
  const { chainCode } = chainParams;
  const logPrefix = `Auto-Retry Missing Actions, ${chainCode} Events -->`;

  try {
    const web3Instance = Web3Service.getWe3Instance({
      chainCode,
      rpcUrl: infura.rpcUrl,
      apiKey: infura.apiKey,
    });

    const currentBlock = await web3Instance.eth.getBlockNumber();
    const blocksInRange = estimateBlockRange(timeRangeEnd);
    const fromBlock = Math.max(0, Number(currentBlock) - blocksInRange);
    const toBlock = Number(currentBlock) - estimateBlockRange(timeRangeStart);

    console.log(
      `${logPrefix} Fetching events from block ${fromBlock} to ${toBlock} (estimated ${blocksInRange} blocks for time range)`,
    );

    const contract = await Web3Service.getWeb3Contract({
      apiKey: infura.apiKey,
      type,
      chainCode,
      contractAddress,
      rpcUrl: infura.rpcUrl,
    });

    // Get all relevant events (consensus_activity, wrapped, unwrapped)
    const allEvents = await contract.getPastEvents('allEvents', {
      fromBlock,
      toBlock,
    });

    console.log(`${logPrefix} Found ${allEvents.length} total events`);

    // Filter events by timestamp - batch block fetches
    const uniqueBlockNumbers = [...new Set(allEvents.map((event) => event.blockNumber))];
    const blockTimestamps = {};

    // Fetch block timestamps in batches to minimize calls
    if (uniqueBlockNumbers.length > 0) {
      console.log(
        `${logPrefix} Fetching timestamps for ${uniqueBlockNumbers.length} unique blocks...`,
      );
      for (const blockNumber of uniqueBlockNumbers) {
        const block = await web3Instance.eth.getBlock(blockNumber);
        blockTimestamps[blockNumber] = Number(block.timestamp) * 1000;
      }
    }

    // Filter events by timestamp
    const now = Date.now();
    const filteredEvents = allEvents.filter((event) => {
      const blockTimestamp = blockTimestamps[event.blockNumber];
      return (
        blockTimestamp >= now - timeRangeEnd && blockTimestamp <= now - timeRangeStart
      );
    });

    // Separate event types
    const consensusEvents = filteredEvents.filter(
      (e) => e.event === 'consensus_activity',
    );
    const wrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.WRAPPED,
    );
    const unwrappedEvents = filteredEvents.filter(
      (e) => e.event === CONTRACT_ACTIONS.UNWRAPPED,
    );

    console.log(
      `${logPrefix} In time range - Consensus: ${consensusEvents.length}, Wrapped: ${wrappedEvents.length}, Unwrapped: ${unwrappedEvents.length}`,
    );

    return {
      consensusEvents,
      wrappedEvents,
      unwrappedEvents,
    };
  } catch (error) {
    console.error(`${logPrefix} Error fetching chain events:`, error.message);
    return {
      consensusEvents: [],
      wrappedEvents: [],
      unwrappedEvents: [],
    };
  }
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const contract = await Web3Service.getWeb3Contract({
        apiKey: chain.infura.apiKey,
        type,
        chainCode,
        contractAddress: chain.contractAddress,
        rpcUrl: chain.infura.rpcUrl,
      });

      let isSuccess = false;

      const actionName = `${ACTIONS.WRAP} ${type}`;

      await blockChainTransaction({
        action: actionName,
        type,
        chainCode,
        contract,
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

      // Log missing action
      addLogMessage({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.MISSING_ACTIONS }),
        message: {
          timestamp,
          action: ACTIONS.UNWRAP,
          type: missingUnwrap.type,
          chainCode,
          txHash: missingUnwrap.txHash,
          details: missingUnwrap.chainEvent.returnValues,
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
    oracleCache.set(CACHE_KEY, false, 0);
  }
};
