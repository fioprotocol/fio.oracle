import 'dotenv/config';

import fetch from 'node-fetch';
import Web3 from 'web3';
import { Fio } from '@fioprotocol/fiojs';
import * as textEncoder from 'text-encoding';

import fioABI from '../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABIonPolygon from '../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import {
  updateEthNonce,
  updatePolygonNonce,
  handlePolygonNonceValue,
  handleEthNonceValue,
} from '../controller/utils/log-files.js';
import { handleEthChainCommon, handlePolygonChainCommon } from '../controller/utils/chain.js';
import { polygonTransaction } from '../controller/utils/transactions.js';
import { getEthGasPriceSuggestion, getPolygonGasPriceSuggestion } from '../controller/utils/prices.js';

import { ACTION_NAMES, CONTRACT_NAMES, ETH_CHAIN_NAME, ETH_TOKEN_CODE, POLYGON_CHAIN_NAME, POLYGON_TOKEN_CODE } from '../controller/constants/chain.js';
import {
  DEFAULT_ETH_GAS_PRICE,
  DEFAULT_POLYGON_GAS_PRICE,
  ETH_GAS_LIMIT,
  POLYGON_GAS_LIMIT,
} from '../controller/constants/prices.js';

import config from '../config/config.js';
import { LOG_FILES_PATH_NAMES } from '../controller/constants/log-files.js';

const { TextEncoder, TextDecoder } = textEncoder;

const web3 = new Web3(process.env.ETHINFURA);
const polygonWeb3 = new Web3(process.env.POLYGON_INFURA);
const fioTokensEthContract = new web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
const fioNftPolygonContract = new web3.eth.Contract(fioNftABIonPolygon, process.env.FIO_NFT_POLYGON_CONTRACT);

const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;

const handleWrapEthAction = async ({
  address,
  amount,
  domain,
  obtId, //txIdOnFioChain
  manualSetGasPrice,
}) => {
  console.log(`ETH WRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`);

  const oraclePublicKey = process.env.ETH_ORACLE_PUBLIC;
  const oraclePrivateKey = process.env.ETH_ORACLE_PRIVATE;

  const wrapFunction = fioTokensEthContract.methods.wrap(
    address,
    amount,
    obtId
  );

  let wrapABI = wrapFunction.encodeABI();

  const chainNonce = await web3.eth.getTransactionCount(
    oraclePublicKey,
    'pending'
  );

  const txNonce = handleEthNonceValue({ chainNonce });

  const common = handleEthChainCommon();

  await polygonTransaction({
    amount,
    actionName: ACTION_NAMES.WRAP_TOKENS,
    chainName: ETH_CHAIN_NAME,
    common,
    contract: process.env.FIO_TOKEN_ETH_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_20,
    data: wrapABI,
    defaultGasPrice: DEFAULT_ETH_GAS_PRICE,
    getGasPriceSuggestionFn: getEthGasPriceSuggestion,
    gasLimit: ETH_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.ETH,
    logPrefix: 'ETH WRAP NPM MANUAL ',
    manualSetGasPrice,
    oraclePrivateKey,
    oraclePublicKey,
    tokenCode: ETH_TOKEN_CODE,
    txNonce,
    updateNonce: updateEthNonce,
    web3Instance: web3,
  });
};


const handleWrapPolygonAction = async ({
  address,
  domain,
  obtId, //txIdOnFioChain
  manualSetGasPrice,
}) => {
  console.log(
    `POLYGON WRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`
  );

  const oraclePublicKey = process.env.POLYGON_ORACLE_PUBLIC;
  const oraclePrivateKey = process.env.POLYGON_ORACLE_PRIVATE;

  const wrapDomainFunction = fioNftPolygonContract.methods.wrapnft(
    address,
    domain,
    obtId
  );
  let wrapABI = wrapDomainFunction.encodeABI();

  const common = handlePolygonChainCommon();

  const chainNonce = await polygonWeb3.eth.getTransactionCount(
    oraclePublicKey,
    'pending'
  );

  const txNonce = handlePolygonNonceValue({ chainNonce });

  await polygonTransaction({
    action: ACTION_NAMES.WRAP_DOMAIN,
    chainName: POLYGON_CHAIN_NAME,
    common,
    contract: config.FIO_NFT_POLYGON_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_721,
    data: wrapABI,
    defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
    domain,
    getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
    gasLimit: POLYGON_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.MATIC,
    logPrefix: 'POLYGON WRAP NPM MANUAL ',
    manualSetGasPrice,
    oraclePrivateKey,
    oraclePublicKey,
    tokenCode: POLYGON_TOKEN_CODE,
    txNonce,
    updateNonce: updatePolygonNonce,
    web3Instance: polygonWeb3,
  });
};

const handleUnwrapFromEthToFioChain = async ({
    address,
    amount,
    domain,
    obtId
}) => {
    console.log(`ETH UNWRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`)

    const isUnwrappingTokens = !!parseInt(amount || '');
    const fioAddress = address;

    let contract = 'fio.oracle',
        actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain',
        oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = process.env.FIO_ORACLE_ACCOUNT;

    const fioChainInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
    const fioLastBlockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
        body: `{"block_num_or_id": ${fioChainInfo.last_irreversible_block_num}}`,
        method: 'POST'
    })).json()

    const chainId = fioChainInfo.chain_id;
    const currentDate = new Date();
    const timePlusTen = currentDate.getTime() + 10000;
    const timeInISOString = (new Date(timePlusTen)).toISOString();
    const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

    const transactionActionsData = {
        fio_address: fioAddress,
        obt_id: obtId,
        actor: oracleAccount
    }

    if (isUnwrappingTokens) {
        transactionActionsData.amount = amount;
    } else transactionActionsData.domain = domain;

    const transaction = {
        expiration,
        ref_block_num: fioLastBlockInfo.block_num & 0xffff,
        ref_block_prefix: fioLastBlockInfo.ref_block_prefix,
        actions: [{
            account: contract,
            name: actionName,
            authorization: [{
                actor: oracleAccount,
                permission: config.FIO_ORACLE_PERMISSION,
            }],
            data: transactionActionsData,
        }]
    };
    const abiMap = new Map();
    const tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
        body: `{"account_name": "fio.oracle"}`,
        method: 'POST'
    })).json()
    abiMap.set('fio.oracle', tokenRawAbi)

    const privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder: new TextDecoder(),
        textEncoder: new TextEncoder()
    });

    const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', { //execute transaction for unwrap
        body: JSON.stringify(tx),
        method: 'POST',
    });
    const transactionResult = await pushResult.json();

    if (!(transactionResult.type || transactionResult.error)) {
        console.log(`Completed:`)
    } else console.log(`Error:`)

    console.log(transactionResult)
}

const handleUnwrapFromPolygonToFioChain = async ({
    address,
    domain,
    obtId
}) => {
    console.log(`POLYGON UNWRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`)
    let contract = 'fio.oracle',
        action = 'unwrapdomain',
        oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = process.env.FIO_ORACLE_ACCOUNT;
    const info = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
    const blockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
        body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`,
        method: 'POST'
    })).json()
    const chainId = info.chain_id;
    const currentDate = new Date();
    const timePlusTen = currentDate.getTime() + 10000;
    const timeInISOString = (new Date(timePlusTen)).toISOString();
    const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

    const transaction = {
        expiration,
        ref_block_num: blockInfo.block_num & 0xffff,
        ref_block_prefix: blockInfo.ref_block_prefix,
        actions: [{
            account: contract,
            name: action,
            authorization: [{
                actor: oracleAccount,
                permission: config.FIO_ORACLE_PERMISSION,
            }],
            data: {
                fio_address: address,
                fio_domain: domain,
                obt_id: obtId,
                actor: oracleAccount
            },
        }]
    };
    let abiMap = new Map();
    let tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
        body: `{"account_name": "fio.oracle"}`,
        method: 'POST'
    })).json()
    abiMap.set('fio.oracle', tokenRawAbi);

    const privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder: new TextDecoder(),
        textEncoder: new TextEncoder()
    });

    const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', {
        body: JSON.stringify(tx),
        method: 'POST',
    });

    const transactionResult = await pushResult.json();

    if (!(transactionResult.type || transactionResult.error)) {
        console.log(`Completed:`)
    } else console.log(`Error:`)

    console.log(transactionResult)
}

const handleBurnNFTInPolygon = async ({
  obtId,
  tokenId,
  manualSetGasPrice,
}) => {
  console.log(`POLYGON BURNNFT --> obtId: ${obtId}, tokenID: ${tokenId}`);

  const oraclePublicKey = process.env.POLYGON_ORACLE_PUBLIC;
  const oraclePrivateKey = process.env.POLYGON_ORACLE_PRIVATE;

  const wrapDomainFunction = fioNftPolygonContract.methods.burnnft(
    tokenId,
    obtId
  );
  let wrapABI = wrapDomainFunction.encodeABI();

  const common = handlePolygonChainCommon();

  const chainNonce = await polygonWeb3.eth.getTransactionCount(
    oraclePublicKey,
    'pending'
  );

  const txNonce = handlePolygonNonceValue({ chainNonce });

  await polygonTransaction({
    action: ACTION_NAMES.BURN_NFT,
    chainName: POLYGON_CHAIN_NAME,
    common,
    contract: config.FIO_NFT_POLYGON_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_721,
    data: wrapABI,
    defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
    getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
    gasLimit: POLYGON_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.MATIC,
    logPrefix: 'POLYGON BURNNFT NPM MANUAL ',
    manualSetGasPrice,
    oraclePrivateKey,
    oraclePublicKey,
    tokenCode: POLYGON_TOKEN_CODE,
    txNonce,
    updateNonce: updatePolygonNonce,
    web3Instance: polygonWeb3,
  });
};

export {
    handleWrapEthAction,
    handleWrapPolygonAction,
    handleUnwrapFromEthToFioChain,
    handleUnwrapFromPolygonToFioChain,
    handleBurnNFTInPolygon,
};
