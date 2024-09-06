import 'dotenv/config';

import fetch from 'node-fetch';

import { checkHttpResponseStatus } from '../utils/general.js';

const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;
const DEFAULT_FIO_SERVER_HISTORY_VERSION = process.env.FIO_SERVER_HISTORY_VERSION;
    
export const getLastIrreversibleBlockOnFioChain = async () => {
  const fioChainInfoResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_info')

  await checkHttpResponseStatus(fioChainInfoResponse, 'Getting FIO chain info went wrong.');

  const fioChainInfo = await fioChainInfoResponse.json();

  let lastBlockNum = 0;
  if (fioChainInfo.last_irreversible_block_num) lastBlockNum = fioChainInfo.last_irreversible_block_num;

    return lastBlockNum;
};

const getActions = async (accountName, pos, offset) => {
  let actionsHistoryResponse
  try {
    actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY + 'v1/history/get_actions', {
        body: JSON.stringify({"account_name": accountName, pos, offset }),
        method: 'POST'
    });
    await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
  } catch (e) {
    if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY_BACKUP + 'v1/history/get_actions', {
        body: JSON.stringify({"account_name": accountName, pos, offset }),
        method: 'POST'
      });
      await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
    }
  }
  const actionsHistory = await actionsHistoryResponse.json();

  return actionsHistory;
};

const getActionsV2 = async ({ accountName, before, after, limit }) => {
  let actionsHistoryResponse
  try {
    actionsHistoryResponse = await fetch(`${process.env.FIO_SERVER_URL_HISTORY}v2/history/get_actions?account=${accountName}&before=${before}&after=${after}&limit=${limit}`)
    await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
  } catch (e) {
    if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(`${process.env.FIO_SERVER_URL_HISTORY}v2/history/get_actions?account=${accountName}&before=${before}&after=${after}&limit=${limit}`)
      await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
    }
  }
  const actionsHistory = await actionsHistoryResponse.json();

  return actionsHistory &&
    actionsHistory.actions &&
    actionsHistory.actions.length
    ? {
        ...actionsHistory,
        actions: actionsHistory.actions
          .map((elem) => ({
            ...elem,
            action_trace: {
              act: elem.act,
              trx_id: elem.trx_id,
            },
          })),
      }
    : actionsHistory;
};

export const getUnprocessedActionsOnFioChain = async ({ accountName, before, after, fioServerHistoryVersion = DEFAULT_FIO_SERVER_HISTORY_VERSION, pos, offset }) => {
  const isV2 = fioServerHistoryVersion === 'hyperion';

  if (isV2) {
    return await getActionsV2({ accountName, before, after, limit: offset });
  } else {
    return await getActions(accountName, pos, offset);
  }
};
