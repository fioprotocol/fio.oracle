import path from 'path';

import dotenv from 'dotenv-safe';
import NodeCache from 'node-cache';

import { SECOND_IN_MILLISECONDS } from '../controller/constants/general.js';

const oracleCache = new NodeCache();

const mode = process.env.NODE_ENV;
const isTestnet = mode === 'testnet';

const envFile = mode ? `.env.${mode}` : '.env';

dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  allowEmptyValues: false,
});

console.log('Uses ' + mode + ' configuration.');

let supportedChains = {};

try {
  supportedChains = JSON.parse(process.env.SUPPORTED_CHAINS);
} catch (error) {
  console.error('Error parsing SUPPORTED_CHAINS: ', error);
}

console.log('Chains: ', supportedChains);

export default {
  mode,
  isTestnet,
  port: process.env.PORT,
  oracleCache,
  fio: {
    FIO_SERVER_URL_HISTORY: process.env.FIO_SERVER_URL_HISTORY,
    FIO_SERVER_URL_HISTORY_BACKUP: process.env.FIO_SERVER_URL_HISTORY_BACKUP,
    FIO_SERVER_URL_ACTION: process.env.FIO_SERVER_URL_ACTION,
    FIO_SERVER_URL_ACTION_BACKUP: process.env.FIO_SERVER_URL_ACTION_BACKUP,
    FIO_ORACLE_PRIVATE_KEY: process.env.FIO_ORACLE_PRIVATE_KEY,
    FIO_ORACLE_ACCOUNT: process.env.FIO_ORACLE_ACCOUNT,
    FIO_ORACLE_PERMISSION: process.env.FIO_ORACLE_PERMISSION,
    FIO_TRANSACTION_MAX_RETRIES: parseInt(process.env.FIO_TRANSACTION_MAX_RETRIES),
    FIO_GET_TABLE_ROWS_OFFSET: parseInt(process.env.FIO_GET_TABLE_ROWS_OFFSET),
    FIO_HISTORY_HYPERION_OFFSET: process.env.FIO_HISTORY_HYPERION_OFFSET,
    LOWEST_ORACLE_ID: parseInt(process.env.LOWEST_ORACLE_ID),
  },
  gas: {
    GAS_PRICE_LEVEL: process.env.GAS_PRICE_LEVEL,
    USE_GAS_API: process.env.USE_GAS_API,
  },
  eth: {
    ETH_ORACLE_PUBLIC: process.env.ETH_ORACLE_PUBLIC,
    ETH_ORACLE_PRIVATE: process.env.ETH_ORACLE_PRIVATE,
    BLOCKS_RANGE_LIMIT_ETH: process.env.BLOCKS_RANGE_LIMIT_ETH,
    BLOCKS_OFFSET_ETH: process.env.BLOCKS_OFFSET_ETH,
    ETH_CONTRACT: process.env.ETH_CONTRACT,
    ETH_CHAIN_NAME: process.env.ETH_CHAIN_NAME,
  },
  infura: {
    apiKey: process.env.INFURA_API_KEY,
  },
  polygon: {
    POLYGON_ORACLE_PUBLIC: process.env.POLYGON_ORACLE_PUBLIC,
    POLYGON_ORACLE_PRIVATE: process.env.POLYGON_ORACLE_PRIVATE,
    BLOCKS_RANGE_LIMIT_POLY: process.env.BLOCKS_RANGE_LIMIT_POLY,
    POLYGON_CONTRACT: process.env.POLYGON_CONTRACT,
  },
  nfts: {
    NFT_PROVIDER_API_KEY: process.env.MORALIS_API_KEY,
  },
  moralis: {
    MORALIS_RPC_BASE_URL: process.env.MORALIS_RPC_BASE_URL,
    MORALIS_RPC_BASE_URL_FALLBACK: process.env.MORALIS_RPC_BASE_URL_FALLBACK,
    MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS:
      process.env.MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS,
  },
  thirdWeb: {
    THIRDWEB_API_KEY: process.env.THIRDWEB_API_KEY,
  },
  jobTimeouts: {
    DEfAULT_JOB_TIMEOUT: process.env.JOB_TIMEOUT,
    BURN_DOMAINS_JOB_TIMEOUT: process.env.BURN_DOMAINS_JOB_TIMEOUT,
  },
  DEFAULT_MAX_RETRIES: process.env.DEFAULT_MAX_RETRIES,
  DEFAULT_HARDFORK: process.env.DEFAULT_HARDFORK,
  app: {
    RESTART_TIMEOUT: SECOND_IN_MILLISECONDS * 5, // 5 seconds
    MAX_RETRIES: 3,
    STABILITY_THRESHOLD: SECOND_IN_MILLISECONDS * 30, // 30 seconds
  },
  supportedChains,
};
