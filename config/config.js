import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv-safe';
import NodeCache from 'node-cache';

import { SECOND_IN_MILLISECONDS } from '../controller/constants/general.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const oracleCache = new NodeCache();

// Determine environment
const mode = process.env.NODE_ENV;
const isTestnet = mode === 'testnet';

// Set config directory for the config package
process.env.NODE_CONFIG_DIR = __dirname;

// Load environment variables using dotenv BEFORE loading config
const envFile = mode ? `.env.${mode}` : '.env';
dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  allowEmptyValues: false,
});

console.log('Uses ' + mode + ' configuration.');

// Import config AFTER setting up environment
const config = (await import('config')).default;

// The config package automatically:
// 1. Loads default.json
// 2. Loads mainnet.json or testnet.json based on NODE_ENV
// 3. Applies custom-environment-variables.json mappings for scalar values
// No custom merge logic needed!

// Helper: resolve ENV_VAR_* placeholders to actual env vars
function resolveEnvPlaceholders(node) {
  if (Array.isArray(node)) {
    return node.map((item) => resolveEnvPlaceholders(item));
  }
  if (node && typeof node === 'object') {
    const out = {};
    Object.keys(node).forEach((key) => {
      out[key] = resolveEnvPlaceholders(node[key]);
    });
    return out;
  }
  if (typeof node === 'string' && node.startsWith('ENV_VAR_')) {
    const envKey = node.replace('ENV_VAR_', '');
    return process.env[envKey] || '';
  }
  return node;
}

// Clone supported chains (config objects are immutable) and resolve placeholders
let supportedChains = JSON.parse(JSON.stringify(config.get('supportedChains')));
supportedChains = resolveEnvPlaceholders(supportedChains);

// Export backward-compatible configuration
export default {
  DEFAULT_HARDFORK: config.get('chainDefaults.defaultHardfork'),
  DEFAULT_MAX_RETRIES: config.get('app.maxRetries'),
  isTestnet,
  mode,
  oracleCache,
  port: config.get('app.port'),

  app: {
    FETCH_TIMEOUT_MS: config.get('app.fetchTimeoutMs'),
    MAX_RETRIES: config.get('app.maxRetries'),
    RESTART_TIMEOUT: config.get('app.restartTimeout') || SECOND_IN_MILLISECONDS * 5,
    STABILITY_THRESHOLD:
      config.get('app.stabilityThreshold') || SECOND_IN_MILLISECONDS * 30,
  },

  autoRetryMissingActions: {
    MAX_RETRIES: config.get('autoRetryMissingActions.maxRetries'),
    RETRY_DELAY_MS: config.get('autoRetryMissingActions.retryDelayMs'),
    TIME_RANGE_END: config.get('autoRetryMissingActions.timeRangeEnd'),
    TIME_RANGE_START: config.get('autoRetryMissingActions.timeRangeStart'),
  },

  aws: {
    AWS_S3_BUCKET: config.get('aws.s3Bucket'),
    AWS_S3_KEY: config.get('aws.s3Key'),
    AWS_S3_PERMITTED_FOLDER: config.get('aws.s3PermittedFolder'),
    AWS_S3_REGION: config.get('aws.s3Region'),
    AWS_S3_SECRET: config.get('aws.s3Secret'),
  },

  fio: {
    FIO_GET_TABLE_ROWS_OFFSET: config.get('fio.getTableRowsOffset'),
    FIO_HISTORY_OFFSET: config.get('fio.historyOffset'),
    FIO_ORACLE_ACCOUNT: config.get('fio.account'),
    FIO_ORACLE_PERMISSION: config.get('fio.permission'),
    FIO_ORACLE_PRIVATE_KEY: config.get('fio.privateKey'),
    FIO_SERVER_URL_ACTION: config.get('fio.serverUrlAction'),
    FIO_SERVER_URL_HISTORY: config.get('fio.serverUrlHistory'),
    FIO_TRANSACTION_MAX_RETRIES: config.get('fio.maxRetries'),
    LOWEST_ORACLE_ID: config.get('fio.lowestOracleId'),
    FIO_SERVER_STALE_THRESHOLD_MINUTES: config.get('fio.serverStaleThresholdMinutes'),
  },

  gas: {
    GAS_PRICE_LEVEL: config.get('chainDefaults.gasPriceLevel'),
    USE_GAS_API: config.get('chainDefaults.useGasApi'),
  },

  jobTimeouts: {
    AUTO_RETRY_MISSING_ACTIONS_TIMEOUT: config.get(
      'jobTimeouts.autoRetryMissingActionsTimeout',
    ),
    BURN_DOMAINS_JOB_TIMEOUT: config.get('jobTimeouts.burnDomainsJobTimeout'),
    DEFAULT_JOB_TIMEOUT: config.get('jobTimeouts.defaultJobTimeout'),
    JOB_LOCK_TTL_SECONDS: config.get('jobTimeouts.jobLockTtlSeconds'),
  },

  logging: {
    ENABLE_S3_SYNC: config.get('logging.enableS3Sync'),
    LOG_TO_FILE: config.get('logging.logToFile'),
    SYNC_INTERVAL_HOURS: config.get('logging.syncIntervalHours'),
  },

  moralis: {
    MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS: config.get(
      'moralis.defaultTimeoutBetweenCalls',
    ),
    MORALIS_RPC_BASE_URL: config.get('moralis.rpcBaseUrl'),
    MORALIS_RPC_BASE_URL_FALLBACK: config.get('moralis.rpcBaseUrlFallback'),
  },

  nfts: {
    NFT_PROVIDER_API_KEY: config.get('moralis.apiKey'),
  },

  supportedChains,

  thirdWeb: {
    THIRDWEB_API_KEY: config.get('thirdWeb.apiKey'),
  },
};
