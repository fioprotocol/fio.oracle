require('dotenv').config();
import { join } from 'path';
import { config as load } from 'dotenv-safe';
import conf_mainnet from "./config-mainnet";
import conf_testnet from "./config-testnet";
const NodeCache = require( "node-cache" );
const oracleCache = new NodeCache();

load({
  example: join(process.cwd(), '.env'),
});

let config = conf_testnet;
let mode = 'testnet';
if (
  // leaving process.argv for backwards compability consider using .env or corss-env and setting MODE
  process.argv && process.argv[2]==="mainnet"
  || process.env.MODE === 'mainnet') {
  config = conf_mainnet;
  mode = 'mainnet';
}

console.log('Uses ' + mode + ' configuration.');

export default {
  mode,
  ...config,
  oracleCache,
};
