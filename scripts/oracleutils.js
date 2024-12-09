import 'dotenv/config';

import Web3 from 'web3';

import fioABI from '../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABIonPolygon from '../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import config from '../config/config.js';
import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  ETH_CHAIN_NAME_CONSTANT,
  ETH_TOKEN_CODE,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
} from '../controller/constants/chain.js';
import { LOG_FILES_PATH_NAMES } from '../controller/constants/log-files.js';
import {
  DEFAULT_ETH_GAS_PRICE,
  DEFAULT_POLYGON_GAS_PRICE,
  ETH_GAS_LIMIT,
  POLYGON_GAS_LIMIT,
} from '../controller/constants/prices.js';
import {
  handleEthChainCommon,
  handlePolygonChainCommon,
} from '../controller/utils/chain.js';
import { runUnwrapFioTransaction } from '../controller/utils/fio-chain.js';
import {
  updateEthNonce,
  updatePolygonNonce,
  handlePolygonNonceValue,
  handleEthNonceValue,
} from '../controller/utils/log-files.js';
import {
  getEthGasPriceSuggestion,
  getPolygonGasPriceSuggestion,
} from '../controller/utils/prices.js';
import { polygonTransaction } from '../controller/utils/transactions.js';

const {
  eth: { ETH_ORACLE_PUBLIC, ETH_ORACLE_PRIVATE, ETH_CONTRACT },
  infura: { eth, polygon },
  polygon: { POLYGON_ORACLE_PUBLIC, POLYGON_ORACLE_PRIVATE, POLYGON_CONTRACT },
} = config;

const web3 = new Web3(eth);
const polygonWeb3 = new Web3(polygon);
const ethContract = new web3.eth.Contract(fioABI, ETH_CONTRACT);
const polygonContract = new web3.eth.Contract(fioNftABIonPolygon, POLYGON_CONTRACT);

const handleWrapEthAction = async ({
  address,
  amount,
  domain,
  obtId, //txIdOnFioChain
  manualSetGasPrice,
}) => {
  console.log(
    `ETH WRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`,
  );

  const oraclePublicKey = ETH_ORACLE_PUBLIC;
  const oraclePrivateKey = ETH_ORACLE_PRIVATE;

  const wrapFunction = ethContract.methods.wrap(address, amount, obtId);

  const wrapABI = wrapFunction.encodeABI();

  const chainNonce = await web3.eth.getTransactionCount(oraclePublicKey, 'pending');

  const txNonce = handleEthNonceValue({ chainNonce });

  const common = handleEthChainCommon();

  await polygonTransaction({
    amount,
    action: ACTION_NAMES.WRAP_TOKENS,
    chainName: ETH_CHAIN_NAME_CONSTANT,
    common,
    contract: ETH_CONTRACT,
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
  console.log(`POLYGON WRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`);

  const oraclePublicKey = POLYGON_ORACLE_PUBLIC;
  const oraclePrivateKey = POLYGON_ORACLE_PRIVATE;

  const wrapDomainFunction = polygonContract.methods.wrapnft(address, domain, obtId);
  const wrapABI = wrapDomainFunction.encodeABI();

  const common = handlePolygonChainCommon();

  const chainNonce = await polygonWeb3.eth.getTransactionCount(
    oraclePublicKey,
    'pending',
  );

  const txNonce = handlePolygonNonceValue({ chainNonce });

  await polygonTransaction({
    action: ACTION_NAMES.WRAP_DOMAIN,
    chainName: POLYGON_CHAIN_NAME,
    common,
    contract: POLYGON_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_721,
    data: wrapABI,
    defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
    domain,
    getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
    gasLimit: POLYGON_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.POLYGON,
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

const handleUnwrapFromEthToFioChain = async ({ address, amount, domain, obtId }) => {
  console.log(
    `ETH UNWRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`,
  );

  const isUnwrappingTokens = !!parseInt(amount || '');
  const fioAddress = address;

  const actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain';

  const transactionActionData = {
    fio_address: fioAddress,
    obt_id: obtId,
  };

  if (isUnwrappingTokens) {
    transactionActionData.amount = amount;
  } else transactionActionData.domain = domain;

  const transactionResult = await runUnwrapFioTransaction({
    actionName,
    transactionActionData,
  });

  if (!(transactionResult.type || transactionResult.error)) {
    console.log(`Completed:`);
  } else console.log(`Error:`);

  console.log(transactionResult);
};

const handleUnwrapFromPolygonToFioChain = async ({ address, domain, obtId }) => {
  console.log(
    `POLYGON UNWRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`,
  );

  const transactionActionData = {
    fio_address: address,
    fio_domain: domain,
    obt_id: obtId,
  };

  const transactionResult = await runUnwrapFioTransaction({
    actionName: 'unwrapdomain',
    transactionActionData,
  });

  if (!(transactionResult.type || transactionResult.error)) {
    console.log(`Completed:`);
  } else console.log(`Error:`);

  console.log(transactionResult);
};

const handleBurnNFTInPolygon = async ({ obtId, tokenId, manualSetGasPrice }) => {
  console.log(`POLYGON BURNNFT --> obtId: ${obtId}, tokenID: ${tokenId}`);

  const oraclePublicKey = POLYGON_ORACLE_PUBLIC;
  const oraclePrivateKey = POLYGON_ORACLE_PRIVATE;

  const wrapDomainFunction = polygonContract.methods.burnnft(tokenId, obtId);
  const wrapABI = wrapDomainFunction.encodeABI();

  const common = handlePolygonChainCommon();

  const chainNonce = await polygonWeb3.eth.getTransactionCount(
    oraclePublicKey,
    'pending',
  );

  const txNonce = handlePolygonNonceValue({ chainNonce });

  await polygonTransaction({
    action: ACTION_NAMES.BURN_NFT,
    chainName: POLYGON_CHAIN_NAME,
    common,
    contract: POLYGON_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_721,
    data: wrapABI,
    defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
    getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
    gasLimit: POLYGON_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.POLYGON,
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
