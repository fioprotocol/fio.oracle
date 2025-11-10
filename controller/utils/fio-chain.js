import 'dotenv/config';

import { Fio } from '@fioprotocol/fiojs';
import fetch from 'node-fetch';
import * as textEncoderObj from 'text-encoding';

import MathOp from './math.js';
import config from '../../config/config.js';
import { handleChainError } from '../../controller/utils/log-files.js';
import { FIO_ACCOUNT_NAMES, FIO_TABLE_NAMES } from '../constants/chain.js';
import { SECOND_IN_MILLISECONDS, MINUTE_IN_MILLISECONDS } from '../constants/general.js';
import {
  checkHttpResponseStatus,
  fetchWithMultipleServers,
  sleep,
} from '../utils/general.js';

const defaultTextEncoderObj = textEncoderObj.default || {};

const TextDecoder = defaultTextEncoderObj.TextDecoder;
const TextEncoder = defaultTextEncoderObj.TextEncoder;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const {
  DEFAULT_MAX_RETRIES,
  fio: {
    FIO_SERVER_URL_ACTION,
    FIO_GET_TABLE_ROWS_OFFSET,
    FIO_ORACLE_PERMISSION,
    FIO_ORACLE_PRIVATE_KEY,
    FIO_ORACLE_ACCOUNT,
    FIO_SERVER_STALE_THRESHOLD_MINUTES,
  },
} = config;

const makeGetInfoUrl = (baseUrl) => `${baseUrl}v1/chain/get_info`;
const makeGetBlockUrl = (baseUrl) => `${baseUrl}v1/chain/get_block`;
const makeGetRawAbiUrl = (baseUrl) => `${baseUrl}v1/chain/get_raw_abi`;
const makePushTransactionUrl = (baseUrl) => `${baseUrl}v1/chain/push_transaction`;
const makeTableRowsUrl = (baseUrl) => `${baseUrl}v1/chain/get_table_rows`;

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

export const getFioOracleNfts = async ({
  serverUrl,
  throwOnEmpty = false,
  options = {},
  accumulator = [],
}) => {
  // Determine lower_bound: use provided option, or calculate from last accumulated row, or start at 0
  let lowerBound = 0;
  if (options?.lowerBound !== undefined) {
    lowerBound = options.lowerBound;
  } else if (accumulator.length > 0) {
    const lastRow = accumulator[accumulator.length - 1];
    if (lastRow && lastRow.id !== undefined) {
      lowerBound = lastRow.id + 1;
    }
  }

  const tableRowsParams = {
    code: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
    scope: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
    table: FIO_TABLE_NAMES.FIO_DOMAINS,
    json: true,
    lower_bound: lowerBound,
    limit: FIO_GET_TABLE_ROWS_OFFSET,
  };

  const logPrefix = '[Get NFTS from Oracle]: ';

  console.log(
    `${logPrefix} ${serverUrl}, lower_bound: ${lowerBound}, accumulated: ${accumulator.length}`,
  );

  // Retry logic with exponential backoff
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= DEFAULT_MAX_RETRIES) {
    try {
      const getTableRowsActionResponse = await fetch(makeTableRowsUrl(serverUrl), {
        method: 'POST',
        body: JSON.stringify(tableRowsParams),
      });

      if (!getTableRowsActionResponse || !getTableRowsActionResponse.ok) {
        const errorStatus = getTableRowsActionResponse?.status || 'unknown';
        lastError = new Error(`HTTP error! status: ${errorStatus}`);

        // Retry on 429 (rate limit) or 5xx errors
        if (
          (errorStatus === 429 || (errorStatus >= 500 && errorStatus < 600)) &&
          retryCount < DEFAULT_MAX_RETRIES
        ) {
          retryCount++;
          const backoffDelay = SECOND_IN_MILLISECONDS * Math.pow(2, retryCount - 1);
          console.log(
            `${logPrefix} Retry ${retryCount}/${DEFAULT_MAX_RETRIES} after ${backoffDelay}ms for status ${errorStatus}`,
          );
          await sleep(backoffDelay);
          continue;
        }

        throw lastError;
      }

      const response = await getTableRowsActionResponse.json();

      if (!response || !Array.isArray(response.rows)) {
        if (throwOnEmpty && accumulator.length === 0) {
          throw new Error('Failed to fetch FIO Oracle NFT domain rows.');
        }

        // Return accumulated rows gathered so far
        return accumulator;
      }

      // Accumulate all rows (don't filter yet - we need all rows to get the last id)
      const allRows = [...accumulator, ...response.rows];

      // If there are more pages, continue fetching
      if (response.more === true && response.rows.length > 0) {
        return await getFioOracleNfts({
          serverUrl,
          throwOnEmpty,
          options,
          accumulator: allRows,
        });
      }

      // No more pages - return accumulated rows
      return allRows;
    } catch (error) {
      lastError = error;
      const errorMessage = error?.message || error?.toString() || 'Unknown error';

      // Retry on network errors or retryable HTTP errors
      if (retryCount < DEFAULT_MAX_RETRIES) {
        retryCount++;
        const backoffDelay = SECOND_IN_MILLISECONDS * Math.pow(2, retryCount - 1);
        console.log(
          `${logPrefix} Retry ${retryCount}/${DEFAULT_MAX_RETRIES} after ${backoffDelay}ms due to error: ${errorMessage}`,
        );
        await sleep(backoffDelay);
        continue;
      }

      // Max retries exceeded
      if (throwOnEmpty && accumulator.length === 0) {
        throw new Error(
          `Failed to fetch FIO Oracle NFT domain rows after ${DEFAULT_MAX_RETRIES} retries: ${errorMessage}`,
        );
      }

      // Return what we have so far if there's an error
      return accumulator;
    }
  }

  // This should never be reached, but handle it just in case
  if (lastError) {
    if (throwOnEmpty && accumulator.length === 0) {
      throw lastError;
    }
    return accumulator;
  }

  // Fallback return (should never reach here)
  return accumulator;
};

const checkServerFreshness = async (serverUrl) => {
  // Default to 5 minutes, can be overridden via environment variable FIO_SERVER_STALE_THRESHOLD_MINUTES
  const STALE_THRESHOLD_MS = FIO_SERVER_STALE_THRESHOLD_MINUTES * MINUTE_IN_MILLISECONDS;

  try {
    const response = await fetch(makeGetInfoUrl(serverUrl));

    if (!response || !response.ok) {
      return {
        isFresh: false,
        error: `HTTP error! status: ${response?.status || 'unknown'}`,
      };
    }

    const chainInfo = await response.json();
    const headBlockTime = chainInfo && chainInfo.head_block_time;

    if (!headBlockTime) {
      return {
        isFresh: false,
        error: 'Missing head_block_time in chain info',
      };
    }

    // Parse as UTC - ensure ISO string has Z suffix for UTC
    const blockTimeIso = headBlockTime.endsWith('Z')
      ? headBlockTime
      : `${headBlockTime}Z`;
    const blockTime = new Date(blockTimeIso);
    if (Number.isNaN(blockTime.getTime())) {
      return {
        isFresh: false,
        error: `Invalid head_block_time format: ${headBlockTime}`,
      };
    }

    // Both times are in UTC milliseconds (Date.now() and getTime() return UTC)
    const nowUtc = Date.now();
    const blockTimeUtc = blockTime.getTime();
    const timeDiff = nowUtc - blockTimeUtc;

    if (timeDiff > STALE_THRESHOLD_MS) {
      const minutesAgo = Math.floor(timeDiff / MINUTE_IN_MILLISECONDS);
      return {
        isFresh: false,
        error: `Server is stale: head_block_time is ${minutesAgo} minutes old (${headBlockTime})`,
        blockTime: blockTimeUtc,
        timeDiff,
      };
    }

    return { isFresh: true, blockTime: blockTimeUtc, timeDiff };
  } catch (error) {
    return {
      isFresh: false,
      error: `Failed to check server freshness: ${error.message}`,
    };
  }
};

export const getFioOracleNftsWithConsensus = async ({ serverUrls } = {}) => {
  const logPrefix = '[FIO Consensus]';
  const domainsLogPrefix = '[GET FIO DOMAINS]';

  if (!Array.isArray(serverUrls) || serverUrls.length === 0) {
    throw new Error(
      'getFioOracleNftsWithConsensus requires a non-empty array of server URLs.',
    );
  }

  const responses = [];
  const statuses = [];
  const staleServers = [];

  for (const serverUrl of serverUrls) {
    // Check server freshness before querying
    const freshnessCheck = await checkServerFreshness(serverUrl);

    if (!freshnessCheck.isFresh) {
      const alertMessage = `${logPrefix} Server ${serverUrl} is stale: ${freshnessCheck.error}`;
      handleChainError({
        logMessage: alertMessage,
        consoleMessage: alertMessage,
      });

      // Store stale server info for potential consensus check
      if (freshnessCheck.blockTime !== undefined) {
        staleServers.push({
          serverUrl,
          blockTime: freshnessCheck.blockTime,
          timeDiff: freshnessCheck.timeDiff,
          error: freshnessCheck.error,
        });
      }

      statuses.push({
        serverUrl,
        status: 'skipped',
        error: freshnessCheck.error,
        count: 0,
      });
      console.log(`${domainsLogPrefix}: server ${serverUrl}, length 0 (stale)`);
      continue;
    }

    try {
      const domains = await getFioOracleNfts({ serverUrl, throwOnEmpty: true });

      responses.push({ serverUrl, domains });
      statuses.push({ serverUrl, status: 'success', count: domains.length });

      console.log(`${domainsLogPrefix}: server ${serverUrl}, length ${domains.length}`);
    } catch (error) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      statuses.push({ serverUrl, status: 'failed', error: errorMessage, count: 0 });
      console.error(
        `${domainsLogPrefix}: server ${serverUrl}, length 0 (failed: ${errorMessage})`,
      );
    }
  }

  // If all servers are stale but in sync, allow proceeding
  if (responses.length === 0 && staleServers.length >= 2) {
    const SYNC_THRESHOLD_MS = 5 * MINUTE_IN_MILLISECONDS; // Servers must be within 5 min of each other
    const blockTimes = staleServers.map((s) => s.blockTime).sort((a, b) => a - b);
    const timeSpread = blockTimes[blockTimes.length - 1] - blockTimes[0];

    if (timeSpread <= SYNC_THRESHOLD_MS) {
      const warningMessage = `${logPrefix} All servers are stale but in sync (within ${Math.floor(timeSpread / MINUTE_IN_MILLISECONDS)} minutes). Proceeding with stale servers.`;
      console.warn(warningMessage);
      handleChainError({
        logMessage: warningMessage,
        consoleMessage: warningMessage,
      });

      // Proceed with stale servers
      for (const staleServer of staleServers) {
        try {
          const domains = await getFioOracleNfts({
            serverUrl: staleServer.serverUrl,
            throwOnEmpty: true,
          });

          responses.push({ serverUrl: staleServer.serverUrl, domains });
          statuses.push({
            serverUrl: staleServer.serverUrl,
            status: 'success (stale)',
            count: domains.length,
          });

          console.log(
            `${domainsLogPrefix}: server ${staleServer.serverUrl}, length ${domains.length} (stale)`,
          );
        } catch (error) {
          const errorMessage = error?.message || error?.toString() || 'Unknown error';
          statuses.push({
            serverUrl: staleServer.serverUrl,
            status: 'failed',
            error: errorMessage,
            count: 0,
          });
          console.error(
            `${domainsLogPrefix}: server ${staleServer.serverUrl}, length 0 (failed: ${errorMessage})`,
          );
        }
      }
    }
  }

  const successfulResponses = responses;

  if (successfulResponses.length < 2) {
    const statusMessage = statuses
      .map(
        (status) =>
          `${status.serverUrl}: ${status.status}${
            status.error ? ` (${status.error})` : ''
          }`,
      )
      .join('; ');

    const errorMessage = `${logPrefix} Consensus failed: fewer than 2 servers succeeded. Statuses: ${statusMessage}`;
    handleChainError({
      logMessage: errorMessage,
      consoleMessage: errorMessage,
    });
    throw new Error(errorMessage);
  }

  // Compare array lengths instead of deep comparison
  const [baseline, ...others] = successfulResponses;
  const baselineCount = baseline.domains.length;

  for (const other of others) {
    const otherCount = other.domains.length;

    if (baselineCount !== otherCount) {
      const differenceMessage = `${logPrefix} Domain count mismatch: ${baseline.serverUrl}=${baselineCount}, ${other.serverUrl}=${otherCount}`;
      handleChainError({
        logMessage: differenceMessage,
        consoleMessage: differenceMessage,
      });
      throw new Error(differenceMessage);
    }
  }

  // Log detailed summary of items retrieved from each server
  console.log(`${logPrefix} Items retrieved per server:`);
  statuses.forEach((status) => {
    const count = status.count !== undefined ? status.count : 0;
    const statusText =
      status.status === 'success'
        ? '✓'
        : status.status === 'success (stale)'
          ? '✓ (stale)'
          : status.status === 'skipped'
            ? '✗ (skipped)'
            : '✗ (failed)';
    console.log(`  ${statusText} ${status.serverUrl}: ${count} items`);
  });

  const statusSummary = statuses
    .map((status) => {
      let statusDetail = '';

      if (status.count !== undefined) {
        statusDetail = ` (${status.count} items)`;
      } else if (status.error) {
        statusDetail = ` (${status.error})`;
      }

      return `${status.serverUrl}: ${status.status}${statusDetail}`;
    })
    .join('; ');

  console.log(
    `${logPrefix} Consensus established across servers. Status summary: ${statusSummary}`,
  );

  return {
    domains: baseline.domains,
    serverSummaries: statuses,
  };
};
