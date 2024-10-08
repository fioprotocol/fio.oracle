import 'dotenv/config';

import fetch from 'node-fetch';

import config from '../../config/config.js';
import { FIO_ACCOUNT_NAMES } from '../constants/chain.js';
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

export const getLastFioOracleAccountPosition = async () =>
  await getLastAccountPosition(FIO_ACCOUNT_NAMES.FIO_ORACLE);
