import 'dotenv/config';

import fetch from 'node-fetch';

import config from '../../config/config.js';
import { FIO_ACCOUNT_NAMES, FIO_TABLE_NAMES } from '../constants/chain.js';
import { MINUTE_IN_MILLISECONDS } from '../constants/general.js';
import {
  checkHttpResponseStatus,
  sleep,
  rateLimiterFor1000Rpm,
} from '../utils/general.js';

const {
  fio: {
    FIO_SERVER_HISTORY_VERSION,
    FIO_SERVER_URL_HISTORY,
    FIO_SERVER_URL_ACTION,
    FIO_SERVER_URL_HISTORY_BACKUP,
    FIO_GET_TABLE_ROWS_OFFSET,
  },
} = config;

export const getLastIrreversibleBlockOnFioChain = async () => {
  const fioChainInfoResponse = await fetch(FIO_SERVER_URL_ACTION + 'v1/chain/get_info');

  await checkHttpResponseStatus(
    fioChainInfoResponse,
    'Getting FIO chain info went wrong.',
  );

  const fioChainInfo = await fioChainInfoResponse.json();

  let lastBlockNum = 0;
  if (fioChainInfo.last_irreversible_block_num)
    lastBlockNum = fioChainInfo.last_irreversible_block_num;

  return lastBlockNum;
};

const getActions = async (accountName, pos, offset) => {
  let actionsHistoryResponse;

  // Schedule the request based on the rate limiter
  await rateLimiterFor1000Rpm.scheduleRequest();

  try {
    actionsHistoryResponse = await fetch(
      FIO_SERVER_URL_HISTORY + 'v1/history/get_actions',
      {
        body: JSON.stringify({ account_name: accountName, pos, offset }),
        method: 'POST',
      },
    );

    if (actionsHistoryResponse.status === 429) {
      console.log('Rate limit exceeded (429), waiting for 60 seconds...');
      await sleep(MINUTE_IN_MILLISECONDS); // Wait for 60 seconds before retrying
      return await getActions(accountName, pos, offset); // Retry the request
    }

    await checkHttpResponseStatus(
      actionsHistoryResponse,
      'Getting FIO actions history went wrong.',
    );
  } catch (e) {
    console.error(e);
    if (FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(
        FIO_SERVER_URL_HISTORY_BACKUP + 'v1/history/get_actions',
        {
          body: JSON.stringify({ account_name: accountName, pos, offset }),
          method: 'POST',
        },
      );

      if (actionsHistoryResponse.status === 429) {
        console.log('Rate limit exceeded (429), waiting for 60 seconds...');
        await sleep(MINUTE_IN_MILLISECONDS); // Wait for 60 seconds before retrying
        return await getActions(accountName, pos, offset); // Retry the request
      }

      await checkHttpResponseStatus(
        actionsHistoryResponse,
        'Getting FIO actions history went wrong.',
      );
    }
  }
  const actionsHistory = actionsHistoryResponse
    ? await actionsHistoryResponse.json()
    : null;

  return actionsHistory;
};

const getActionsV2 = async ({ accountName, before, after, limit }) => {
  let actionsHistoryResponse;

  // Schedule the request based on the rate limiter
  await rateLimiterFor1000Rpm.scheduleRequest();

  try {
    actionsHistoryResponse = await fetch(
      `${FIO_SERVER_URL_HISTORY}v2/history/get_actions?account=${accountName}&before=${before}&after=${after}&limit=${limit}`,
    );

    if (actionsHistoryResponse.status === 429) {
      console.log('Rate limit exceeded (429), waiting for 60 seconds...');
      await sleep(MINUTE_IN_MILLISECONDS); // Wait for 60 seconds before retrying
      return await getActionsV2({ accountName, before, after, limit }); // Retry the request
    }

    await checkHttpResponseStatus(
      actionsHistoryResponse,
      'Getting FIO actions history went wrong.',
    );
  } catch (e) {
    console.error(e);
    if (FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(
        `${FIO_SERVER_URL_HISTORY_BACKUP}v2/history/get_actions?account=${accountName}&before=${before}&after=${after}&limit=${limit}`,
      );

      if (actionsHistoryResponse.status === 429) {
        console.log('Rate limit exceeded (429), waiting for 60 seconds...');
        await sleep(MINUTE_IN_MILLISECONDS); // Wait for 60 seconds before retrying
        return await getActionsV2({ accountName, before, after, limit }); // Retry the request
      }

      await checkHttpResponseStatus(
        actionsHistoryResponse,
        'Getting FIO actions history went wrong.',
      );
    }
  }
  const actionsHistory = actionsHistoryResponse
    ? await actionsHistoryResponse.json()
    : null;

  return actionsHistory && actionsHistory.actions && actionsHistory.actions.length
    ? {
        ...actionsHistory,
        actions: actionsHistory.actions.map((elem) => ({
          ...elem,
          action_trace: {
            act: elem.act,
            trx_id: elem.trx_id,
          },
        })),
      }
    : actionsHistory;
};

// todo: remove
export const getUnprocessedActionsOnFioChain = async ({
  accountName,
  before,
  after,
  fioServerHistoryVersion = FIO_SERVER_HISTORY_VERSION,
  pos,
  offset,
}) => {
  const isV2 = fioServerHistoryVersion === 'hyperion';

  if (isV2) {
    return await getActionsV2({ accountName, before, after, limit: offset });
  } else {
    return await getActions(accountName, pos, offset);
  }
};

export const getLastAccountPosition = async (accountName) => {
  const res = await getActions(accountName, -1, -1);

  if (!res || (res && !res.actions)) return 0;

  return res.actions[0].account_action_seq;
};

export const getLastFioAddressAccountPosition = async () =>
  await getLastAccountPosition(FIO_ACCOUNT_NAMES.FIO_ADDRESS);

export const getTableRows = async ({ logPrefix, tableRowsParams }) => {
  try {
    const tableRowsResponse = await fetch(
      `${FIO_SERVER_URL_ACTION}v1/chain/get_table_rows`,
      {
        body: JSON.stringify(tableRowsParams),
        method: 'POST',
      },
    );

    return tableRowsResponse ? tableRowsResponse.json() : null;
  } catch (error) {
    handleChainError({
      logMessage: `${logPrefix} ${error}`,
      consoleMessage: `GET TABLE ROWS ERROR: ${error}`,
    });
  }
};

export const getLastFioOracleItemId = async () => {
  const logPrefix = 'Get last FIO Oracle Item ID';
  try {
    const tableRowsParams = {
      json: true,
      code: FIO_ACCOUNT_NAMES.FIO_ORACLE,
      scope: FIO_ACCOUNT_NAMES.FIO_ORACLE,
      table: FIO_TABLE_NAMES.FIO_ORACLE_LDGRS,
      limit: 1,
      reverse: true,
    };

    const response = await getTableRows({
      logPrefix,
      tableRowsParams,
    });

    return response && response.rows[0] ? response.rows[0].id + 1 : null; // Set id + 1 because if we will set id as it is then it will process already processed wrap item
  } catch (error) {
    handleChainError({
      logMessage: `${logPrefix} ${error}`,
      consoleMessage: `${logPrefix} ERROR: ${error}`,
    });
  }
};

export const getOracleItems = async ({
  accumulator = [],
  logPrefix,
  lowerBound,
  upperBound,
}) => {
  const tableRowsParams = {
    json: true,
    code: FIO_ACCOUNT_NAMES.FIO_ORACLE,
    limit: FIO_GET_TABLE_ROWS_OFFSET,
    scope: FIO_ACCOUNT_NAMES.FIO_ORACLE,
    table: FIO_TABLE_NAMES.FIO_ORACLE_LDGRS,
    reverse: true,
  };

  if (lowerBound) {
    tableRowsParams.lower_bound = lowerBound;
  }

  if (upperBound) {
    tableRowsParams.upper_bound = upperBound;
  }

  const response = await getTableRows({ logPrefix, tableRowsParams });

  try {
    if (!response || !response.rows || response.rows.length === 0) {
      return accumulator;
    }

    const { rows, more } = response;
    const updatedItems = [...accumulator, ...rows];

    if (!more) {
      return updatedItems;
    }

    const lastRow = rows[rows.length - 1];

    return getOracleItems({
      accumulator: updatedItems,
      logPrefix,
      lowerBound,
      upperBound: lastRow.id - 1,
    });
  } catch (error) {
    handleChainError({
      logMessage: `${logPrefix} ${error}`,
      consoleMessage: `${logPrefix} ERROR: ${error}`,
    });
  }
};
