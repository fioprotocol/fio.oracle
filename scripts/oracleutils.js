const {FIOSDK } = require('@fioprotocol/fiosdk');
const fetch = require('node-fetch');
require('dotenv').config();

const fioABI = require('../config/ABI/FIO.json');
const fioNftABI = require('../config/ABI/FIONFT.json');
const Web3 = require('web3');
const web3 = new Web3(process.env.ETHINFURA);
const fioContract = new web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
const fioNftContract = new web3.eth.Contract(fioNftABI, process.env.FIO_NFT_POLYGON_CONTRACT);

const baseUrl = process.env.FIO_SERVER_URL_ACTION + 'v1/',
  privateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
  publicKey = process.env.FIO_ORACLE_PUBLIC_KEY,
  fioAddress = process.env.FIO_ORACLE_ADDRESS,
  ethPubAddress = process.env.ETH_ORACLE_PUBLIC,
  polyPubAddress = process.env.POLYGON_ORACLE_PUBLIC,
  gas = process.env.TGASLIMIT,
  gasPrice = process.env.TGASPRICE.toString() + "000000000000"

const fetchJson = async (uri, opts = {}) => {
  return fetch(uri, opts)
}

const user = new FIOSDK(
  privateKey,
  publicKey,
  baseUrl,
  fetchJson
)

const wrapTokens = async (amount, account, obtid) => {
  const result = fioContract.methods
    .wrap(account, amount, obtid)
    .send({ 
      from: ethPubAddress,
      gas: gas,  // Limit
      gasPrice: gasPrice
    });
  return result;
}

const wrapDomain = async (domain, account, obtid) => {
  const result = fioNftContract.methods
    .wrapnft(account, domain, obtid)
    .send({ 
      from: polyPubAddress,
      gas: gas,  // Limit
      gasPrice: gasPrice
    });
  return result;
}

const unwrapTokens = async (amount, address, obtid) => {
  const result = await user.genericAction('pushTransaction', {
    action: 'unwraptokens',
    account: 'fio.oracle',
    data: {
      amount: amount,
      obt_id: obtid,
      fio_address: address
    }
  });
  return result;
}

const unwrapDomain = async (domain, address, obtid) => {
  await user.genericAction('pushTransaction', {
    action: 'unwrapdomain',
    account: 'fio.oracle',
    data: {
      fio_domain: domain,
      obt_id: obtid,
      fio_address: address
    }
});
  return result;
}

module.exports = {unwrapTokens, unwrapDomain, wrapTokens, wrapDomain};
