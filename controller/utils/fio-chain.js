import 'dotenv/config';

import fetch from 'node-fetch';

import {
  getLastProceededBlockNumberOnFioChain,
  getLastProceededBlockNumberOnFioChainForBurnNFT,
} from '../utils/log-files.js';
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
        body: JSON.stringify({"account_name": accountName, "pos": pos, offset: offset}),
        method: 'POST'
    });
    await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
  } catch (e) {
    if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY_BACKUP + 'v1/history/get_actions', {
        body: JSON.stringify({"account_name": accountName, "pos": pos, offset: offset}),
        method: 'POST'
      });
      await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
    }
  }
  const actionsHistory = await actionsHistoryResponse.json();

  let result = [];
  if (actionsHistory.actions.length) result = actionsHistory.actions.filter(elem => elem.block_num <= actionsHistory.last_irreversible_block)
  return result;
};

const getActionsV2 = async (accountName, skip, limit, lastIrreversibleBlock) => {
  let actionsHistoryResponse
  try {
    actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY + 'v2/history/get_actions?account=' + accountName + '&skip=' + skip + '&limit=' + limit)
    await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
  } catch (e) {
    if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
      actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY_BACKUP + 'v2/history/get_actions?account=' + accountName + '&skip=' + skip + '&limit=' + limit)
      await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
    }
  }
  const actionsHistory = await actionsHistoryResponse.json();

  let result = [];
  if (actionsHistory.actions.length) {
    result = actionsHistory.actions.filter(elem => elem.block_num <= lastIrreversibleBlock).map(elem => ({
      ...elem,
      action_trace: {
        act: elem.act,
        trx_id: elem.trx_id,
      },
    }));
  }
  return result;
};

export const getUnprocessedActionsOnFioChain = async ({ accountName, pos, logPrefix, fioServerHistoryVersion = DEFAULT_FIO_SERVER_HISTORY_VERSION, isBurnNft = false }) => {
  let lastNumber = null;

  if (isBurnNft) {
      lastNumber = getLastProceededBlockNumberOnFioChainForBurnNFT();
  } else {
      lastNumber = getLastProceededBlockNumberOnFioChain();
  }

  console.log(logPrefix + `start Block Number = ${lastNumber + 1}, end Block Number: ${pos}`)

  let data = []
  const isV2 = fioServerHistoryVersion === 'hyperion';
  if (isV2) {
    let hasMore = true;
    let skip = 0;
    const limit = parseInt(process.env.HYPERION_LIMIT) || 10
    const lastIrreversibleBlock = await getLastIrreversibleBlockOnFioChain();

    while (hasMore) {
        const dataPart = await getActionsV2(accountName, skip, limit, lastIrreversibleBlock);
        data = data.concat(dataPart);

        hasMore = dataPart[dataPart.length - 1].block_num > lastNumber
        skip += limit;
    }
    data = data.reverse();
  } else {
    let offset = parseInt(process.env.POLLOFFSET) || -10;
    data = await getActions(accountName, pos, offset);
    while (data.length > 0 && data[0].block_num > lastNumber) {
        offset -= 10;
        data = await getActions(accountName, pos, offset);
    }
  }
  return data.filter(elem => (elem.block_num > lastNumber))
};
