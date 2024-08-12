import 'dotenv/config';

import fetch from 'node-fetch';

import MathOp from './math.js';

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

  return actionsHistory;
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

export const getUnprocessedActionsOnFioChain = async ({ accountName, logPrefix, fioServerHistoryVersion = DEFAULT_FIO_SERVER_HISTORY_VERSION, isBurnNft = false }) => {
  let lastAccountActionSequence = null;
  let lastProcessedAccountActionSequence = null;

  if (isBurnNft) {
      lastAccountActionSequence =
        getLastProceededBlockNumberOnFioChainForBurnNFT();
  } else {
      lastAccountActionSequence = getLastProceededBlockNumberOnFioChain();
  }

  console.log(
    logPrefix + `start Account Action Sequence = ${lastAccountActionSequence}`
  );

  let unprocessedActionsList = [];
  const isV2 = fioServerHistoryVersion === 'hyperion';

  const getFioActionsLogsAll = async ({ pos, actionsList }) => {
    const offset = (process.env.POLLOFFSET);

    const actionsLogsResult = await getActions(accountName, pos, offset);

    const actionsLogsLength =
      actionsLogsResult &&
      actionsLogsResult.actions &&
      actionsLogsResult.actions.length
        ? actionsLogsResult.actions.length
        : 0;

    const actionTraceHasNonIrreversibleBlockIndex =
      actionsLogsResult && actionsLogsResult.actions
        ? actionsLogsResult.actions.findIndex((actionItem) =>
            new MathOp(actionItem.block_num).gt(
              actionsLogsResult.last_irreversible_block
            )
          )
        : null;

    if (
      actionsLogsResult &&
      actionsLogsResult.last_irreversible_block &&
      actionsLogsResult.actions &&
      actionsLogsLength > 0 &&
      actionTraceHasNonIrreversibleBlockIndex < 0
    ) {
      actionsList.push(...actionsLogsResult.actions);
      lastProcessedAccountActionSequence =
        actionsList[actionsList.length - 1].account_action_seq;
      await getFioActionsLogsAll({ pos: pos + actionsLogsLength, actionsList });
    }

    if (actionTraceHasNonIrreversibleBlockIndex >= 0) {
      actionsList.push(
        ...actionsLogsResult.actions.slice(
          0,
          actionTraceHasNonIrreversibleBlockIndex
        )
      );

      lastProcessedAccountActionSequence =
        actionTraceHasNonIrreversibleBlockIndex > 0
          ? actionsLogsResult.actions[
              actionTraceHasNonIrreversibleBlockIndex - 1
            ].account_action_seq
          : lastProcessedAccountActionSequence;
    }
  };

  if (isV2) {
    let hasMore = true;
    let skip = 0;
    const limit = parseInt(process.env.HYPERION_LIMIT);
    const lastIrreversibleBlock = await getLastIrreversibleBlockOnFioChain();

    while (hasMore) {
        const dataPart = await getActionsV2(accountName, skip, limit, lastIrreversibleBlock);
        unprocessedActionsList = unprocessedActionsList.concat(dataPart);
        const dataPartAccountActionSequence =
          dataPart[dataPart.length - 1] &&
          dataPart[dataPart.length - 1].account_action_seq;

        hasMore = dataPartAccountActionSequence > accountActionSequence;
        skip += limit;
    }
    unprocessedActionsList = unprocessedActionsList.reverse();
  } else {
    await getFioActionsLogsAll({
      pos:
        lastAccountActionSequence > 0
          ? new MathOp(lastAccountActionSequence).add(1).toNumber()
          : lastAccountActionSequence,
      actionsList: unprocessedActionsList,
    });
  }

  return unprocessedActionsList.filter(
    (elem) => elem.account_action_seq > lastAccountActionSequence
  );
};
