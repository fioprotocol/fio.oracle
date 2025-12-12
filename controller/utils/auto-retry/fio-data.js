import config from '../../../config/config.js';
import {
  ACTIONS,
  ACTION_TYPES,
  FIO_ACCOUNT_NAMES,
  FIO_CONTRACT_ACTIONS,
} from '../../constants/chain.js';
import { getOracleItems } from '../fio-chain.js';
import { fetchWithMultipleServers, convertTimestampIntoMs } from '../general.js';
import {
  createMemoryCheckpoint,
  logMemoryDelta,
  logArraySize,
} from '../memory-logger.js';

const {
  fio: { FIO_SERVER_URL_HISTORY, FIO_HISTORY_OFFSET },
} = config;

// Fetch wrap oracle items from FIO get_table_rows and filter by time range
export const getWrapOracleItems = async ({ afterTimestamp, beforeTimestamp }) => {
  const logPrefix = 'Auto-Retry Missing Actions, FIO Wrap Oracle Items -->';
  const functionStart = createMemoryCheckpoint('getWrapOracleItems start', logPrefix);

  try {
    const beforeFetch = createMemoryCheckpoint('Before fetching oracle items', logPrefix);
    const oracleItems = await getOracleItems({
      logPrefix,
      lowerBound: 0,
    });
    logMemoryDelta('After fetching oracle items', beforeFetch, logPrefix);
    logArraySize('oracleItems (all)', oracleItems, logPrefix);

    const beforeFilter = createMemoryCheckpoint(
      'Before filtering oracle items',
      logPrefix,
    );
    const filtered = oracleItems.filter(({ timestamp }) => {
      const tsMs = convertTimestampIntoMs(timestamp);
      return tsMs >= afterTimestamp && tsMs <= beforeTimestamp;
    });
    logMemoryDelta('After filtering by time range', beforeFilter, logPrefix);
    logArraySize('oracleItems (filtered)', filtered, logPrefix);

    const wrapTokensItems = filtered.filter((item) => item.amount);
    const wrapDomainsItems = filtered.filter((item) => item.nftname);
    logArraySize('wrapTokensItems', wrapTokensItems, logPrefix);
    logArraySize('wrapDomainsItems', wrapDomainsItems, logPrefix);

    logMemoryDelta('getWrapOracleItems complete', functionStart, logPrefix);
    return { wrapTokensItems, wrapDomainsItems };
  } catch (error) {
    console.error(`${logPrefix} Error fetching wrap oracle items:`, error.message);
    return { wrapTokensItems: [], wrapDomainsItems: [] };
  }
};

// Internal: fetch actions for account from FIO history v1 API within time window
export const getAccountActions = async ({ accountName, startTime, endTime }) => {
  const logPrefix = 'Auto-Retry Missing Actions, FIO Actions -->';

  const serverUrls = Array.isArray(FIO_SERVER_URL_HISTORY)
    ? FIO_SERVER_URL_HISTORY
    : typeof FIO_SERVER_URL_HISTORY === 'string' && FIO_SERVER_URL_HISTORY
      ? FIO_SERVER_URL_HISTORY.split(',')
          .map((u) => u.trim())
          .filter(Boolean)
      : [];

  if (serverUrls.length === 0) {
    throw new Error('No FIO history server URLs configured');
  }

  const allActions = [];
  let pos = -1;
  const offset = -FIO_HISTORY_OFFSET;
  let hasMore = true;

  const startTimeMs = new Date(startTime).getTime();
  const endTimeMs = new Date(endTime).getTime();

  while (hasMore) {
    try {
      const params = { account_name: accountName, pos, offset };

      const response = await fetchWithMultipleServers({
        serverUrls,
        urlBuilder: (baseUrl) => {
          const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          return `${normalized}/v1/history/get_actions`;
        },
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
      });

      const data = await response.json();
      if (!data.actions || data.actions.length === 0) break;

      for (const action of data.actions) {
        const actionTime = action.block_time;
        const actionTimeMs = new Date(actionTime).getTime();

        if (actionTimeMs > endTimeMs) continue; // too new
        if (actionTimeMs < startTimeMs) {
          hasMore = false; // too old; stop
          break;
        }

        const normalizedAction = {
          ...action,
          act:
            action.action_trace && action.action_trace.act
              ? action.action_trace.act
              : action.act,
        };
        allActions.push(normalizedAction);
      }

      const lastAction = data.actions[data.actions.length - 1];
      pos = lastAction.account_action_seq - 1;
      if (data.actions.length < Math.abs(offset)) break;

      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`${logPrefix} Error fetching actions:`, error.message);
      break;
    }
  }

  return allActions;
};

// Fetch unwrap actions from history and filter by action name
export const getUnwrapFioActions = async ({ afterTimestamp, beforeTimestamp }) => {
  const logPrefix = 'Auto-Retry Missing Actions, FIO Unwrap Actions -->';
  const functionStart = createMemoryCheckpoint('getUnwrapFioActions start', logPrefix);

  try {
    const beforeFetch = createMemoryCheckpoint('Before fetching FIO actions', logPrefix);
    const allActions = await getAccountActions({
      accountName: FIO_ACCOUNT_NAMES.FIO_ORACLE,
      startTime: new Date(afterTimestamp).toISOString(),
      endTime: new Date(beforeTimestamp).toISOString(),
    });
    logMemoryDelta('After fetching FIO actions', beforeFetch, logPrefix);
    logArraySize('allActions', allActions, logPrefix);

    const beforeFilter = createMemoryCheckpoint('Before filtering actions', logPrefix);
    const unwrapTokensActions = allActions.filter(
      (a) =>
        a.act && a.act.name === FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][ACTION_TYPES.TOKENS],
    );
    const unwrapDomainsActions = allActions.filter(
      (a) =>
        a.act && a.act.name === FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][ACTION_TYPES.NFTS],
    );
    logMemoryDelta('After filtering actions', beforeFilter, logPrefix);
    logArraySize('unwrapTokensActions', unwrapTokensActions, logPrefix);
    logArraySize('unwrapDomainsActions', unwrapDomainsActions, logPrefix);

    logMemoryDelta('getUnwrapFioActions complete', functionStart, logPrefix);
    return { unwrapTokensActions, unwrapDomainsActions };
  } catch (error) {
    console.error(`${logPrefix} Error fetching unwrap actions:`, error.message);
    return { unwrapTokensActions: [], unwrapDomainsActions: [] };
  }
};
