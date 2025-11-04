import 'dotenv/config';

import { Fio } from '@fioprotocol/fiojs';
import * as textEncoderObj from 'text-encoding';

import MathOp from './math.js';
import config from '../../config/config.js';
import { handleChainError } from '../../controller/utils/log-files.js';
import { FIO_ACCOUNT_NAMES, FIO_TABLE_NAMES } from '../constants/chain.js';
import { checkHttpResponseStatus, fetchWithMultipleServers } from '../utils/general.js';

const defaultTextEncoderObj = textEncoderObj.default || {};

const TextDecoder = defaultTextEncoderObj.TextDecoder;
const TextEncoder = defaultTextEncoderObj.TextEncoder;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const {
  fio: {
    FIO_SERVER_URL_HISTORY,
    FIO_SERVER_URL_ACTION,
    FIO_GET_TABLE_ROWS_OFFSET,
    FIO_ORACLE_PERMISSION,
    FIO_ORACLE_PRIVATE_KEY,
    FIO_ORACLE_ACCOUNT,
  },
} = config;

const makeGetInfoUrl = (baseUrl) => `${baseUrl}v1/chain/get_info`;
const makeGetBlockUrl = (baseUrl) => `${baseUrl}v1/chain/get_block`;
const makeGetRawAbiUrl = (baseUrl) => `${baseUrl}v1/chain/get_raw_abi`;
const makePushTransactionUrl = (baseUrl) => `${baseUrl}v1/chain/push_transaction`;
const makeTableRowsUrl = (baseUrl) => `${baseUrl}v1/chain/get_table_rows`;
const makeDeltasUrl = ({ baseUrl, params }) => {
  const queryString = new URLSearchParams(params).toString();
  return `${baseUrl}v2/history/get_deltas?${queryString}`;
};

const getFioChainInfo = async () =>
  await (
    await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_ACTION,
      urlBuilder: makeGetInfoUrl,
    })
  ).json();

const getFioBlockInfo = async (lastIrreversibleBlock) =>
  await (
    await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_ACTION,
      urlBuilder: makeGetBlockUrl,
      options: {
        body: JSON.stringify({ block_num_or_id: lastIrreversibleBlock }),
        method: 'POST',
      },
    })
  ).json();

const getFioOracleRawAbi = async () =>
  await (
    await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_ACTION,
      urlBuilder: makeGetRawAbiUrl,
      options: {
        body: JSON.stringify({ account_name: FIO_ACCOUNT_NAMES.FIO_ORACLE }),
        method: 'POST',
      },
    })
  ).json();

const pushFioTransaction = async (tx) =>
  await fetchWithMultipleServers({
    serverUrls: FIO_SERVER_URL_ACTION,
    urlBuilder: makePushTransactionUrl,
    options: {
      body: JSON.stringify(tx),
      method: 'POST',
    },
  });

export const getLastIrreversibleBlockOnFioChain = async () => {
  const fioChainInfoResponse = await fetchWithMultipleServers({
    serverUrls: FIO_SERVER_URL_ACTION,
    urlBuilder: makeGetInfoUrl,
  });

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

export const getTableRows = async ({ logPrefix, tableRowsParams }) => {
  try {
    const tableRowsResponse = await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_ACTION,
      urlBuilder: makeTableRowsUrl,
      options: {
        body: JSON.stringify(tableRowsParams),
        method: 'POST',
      },
    });

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

    return response && response.rows[0]
      ? new MathOp(response.rows[0].id).add(1).toNumber() // Use math operator to be sure we will have correct math operation
      : null; // Set id + 1 because if we will set id as it is then it will process already processed wrap item
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

export const getFioDeltasV2 = async (params) => {
  let response = null;

  try {
    const res = await fetchWithMultipleServers({
      serverUrls: FIO_SERVER_URL_HISTORY,
      urlBuilder: (baseUrl) => makeDeltasUrl({ baseUrl, params }),
    });
    response = res.json();
  } catch (error) {
    console.log('error', error);
    handleChainError({
      logMessage: `Failed to fetch deltas from V2: ${error.message}`,
      consoleMessage: `Failed to fetch deltas from V2: ${error}`,
    });
  }

  return response;
};

export const runUnwrapFioTransaction = async ({ actionName, transactionActionData }) => {
  try {
    const contract = FIO_ACCOUNT_NAMES.FIO_ORACLE,
      oraclePrivateKey = FIO_ORACLE_PRIVATE_KEY;

    const fioChainInfo = await getFioChainInfo();
    const fioLastBlockInfo = await getFioBlockInfo(
      fioChainInfo.last_irreversible_block_num,
    );

    const chainId = fioChainInfo.chain_id;
    const currentDate = new Date();
    const timePlusTen = currentDate.getTime() + 10000;
    const timeInISOString = new Date(timePlusTen).toISOString();
    const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

    const transaction = {
      expiration,
      ref_block_num: fioLastBlockInfo.block_num & 0xffff,
      ref_block_prefix: fioLastBlockInfo.ref_block_prefix,
      actions: [
        {
          account: contract,
          name: actionName,
          authorization: [
            {
              actor: FIO_ORACLE_ACCOUNT,
              permission: FIO_ORACLE_PERMISSION,
            },
          ],
          data: {
            ...transactionActionData,
            actor: FIO_ORACLE_ACCOUNT,
          },
        },
      ],
    };

    const abiMap = new Map();
    const tokenRawAbi = await getFioOracleRawAbi();
    abiMap.set(FIO_ACCOUNT_NAMES.FIO_ORACLE, tokenRawAbi);

    const privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
      transaction,
      chainId,
      privateKeys,
      abiMap,
      textDecoder,
      textEncoder,
    });

    const pushResult = await pushFioTransaction(tx);

    if (!pushResult) throw new Error('No push transaction result.');

    const transactionResult = await pushResult.json();

    return transactionResult;
  } catch (error) {
    console.log('Unwrap FIO transaction fail:', error);
    throw error;
  }
};
