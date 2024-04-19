import 'dotenv/config';
import { config as load } from 'dotenv-safe';
import { join } from 'path';
import NodeCache from 'node-cache';
const oracleCache = new NodeCache();

import conf_mainnet from './config-mainnet.js';
import conf_testnet from './config-testnet.js';

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
};
