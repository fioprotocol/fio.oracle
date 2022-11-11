require('dotenv').config();
const { config: load } = require( "dotenv-safe" );
const { join } = require( "path" );
const NodeCache = require( "node-cache" );
const oracleCache = new NodeCache();

const conf_mainnet = require("./config-mainnet");
const conf_testnet = require("./config-testnet");

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

module.exports = {
  mode,
  ...config,
  oracleCache,
};
