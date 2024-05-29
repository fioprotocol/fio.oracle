import 'dotenv/config';
import { config as load } from 'dotenv-safe';
import { join } from 'path';
import NodeCache from 'node-cache';
const oracleCache = new NodeCache();

import conf_mainnet from './config-mainnet.js';
import conf_testnet from './config-testnet.js';

const NFT_TESTNET_CHAIN_NAME =
  process.env.NFT_DEFAULT_TESTNET_CHAIN_NAME || 'POLYGON_AMOY';
const NFT_MAINNET_CHAIN_NAME = process.env.NFT_MAINNET_CHAIN_NAME || 'POLYGON';

const NFT_CHAIN_NAME =
  process.env.MODE === 'testnet'
    ? NFT_TESTNET_CHAIN_NAME
    : NFT_MAINNET_CHAIN_NAME;

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;

load({
  example: join(process.cwd(), '.env'),
});

let config = conf_testnet;
let mode = 'testnet';
if (
  // leaving process.argv for backwards compability consider using .env or corss-env and setting MODE
  (process.argv && process.argv[2] === 'mainnet') ||
  process.env.MODE === 'mainnet'
) {
  config = conf_mainnet;
  mode = 'mainnet';
}

console.log('Uses ' + mode + ' configuration.');

export default {
  mode,
  ...config,
  oracleCache,
  FIO_ORACLE_PERMISSION: process.env.FIO_ORACLE_PERMISSION || 'active',
  NFTS: {
    NFT_CHAIN_NAME: NFT_CHAIN_NAME,
    NFT_PROVIDER_API_KEY: MORALIS_API_KEY,
  },
  THIRDWEB_API_KEY: process.env.THIRDWEB_API_KEY,
  MORALIS_RPC_BASE_URL: process.env.MORALIS_RPC_BASE_URL,
  MORALIS_RPC_BASE_URL_FALLBACK: process.env.MORALIS_RPC_BASE_URL_FALLBACK,
  MORALIS_RPC_ETH_CHAIN_NAME: process.env.MORALIS_RPC_ETH_CHAIN_NAME,
  MORALIS_RPC_POLYGON_CHAIN_NAME: process.env.MORALIS_RPC_POLYGON_CHAIN_NAME,
};
