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
export default {
  mode,
  isTestnet,
  port: process.env.PORT,
  oracleCache,
  aws: {
    AWS_S3_KEY: process.env.AWS_S3_KEY,
    AWS_S3_SECRET: process.env.AWS_S3_SECRET,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_S3_REGION: process.env.AWS_S3_REGION,
    AWS_S3_PERMITTED_FOLDER: process.env.AWS_S3_PERMITTED_FOLDER,
  },
  logging: {
    LOG_TO_FILE: process.env.LOG_TO_FILE !== 'false', // Default true - if false, writes to console
    SYNC_INTERVAL_HOURS: parseInt(process.env.SYNC_INTERVAL_HOURS) || 1, // Default: sync every 1 hour
    ENABLE_S3_SYNC: process.env.ENABLE_S3_SYNC !== 'false', // Default true - if false, S3 sync disabled
  },
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
  infura: {
    apiKey: process.env.INFURA_API_KEY,
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
    DEFAULT_JOB_TIMEOUT: process.env.JOB_TIMEOUT,
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
