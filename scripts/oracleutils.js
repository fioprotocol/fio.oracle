import 'dotenv/config';

import {
  ACTION_NAMES,
  ETH_CHAIN_NAME_CONSTANT,
  POLYGON_CHAIN_NAME,
} from '../controller/constants/chain.js';

import { runUnwrapFioTransaction } from '../controller/utils/fio-chain.js';

import { blockChainTransaction } from '../controller/utils/transactions.js';

const handleWrapEthAction = async ({
  address,
  amount,
  domain,
  obtId, // oracleId from FIO wrapped table
  manualSetGasPrice,
}) => {
  console.log(
    `ETH WRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`,
  );

  await blockChainTransaction({
    action: ACTION_NAMES.WRAP_TOKENS,
    chainName: ETH_CHAIN_NAME_CONSTANT,
    contractActionParams: {
      amount,
      obtId,
      pubaddress: address,
    },
    logPrefix: 'ETH WRAP NPM MANUAL ',
    manualSetGasPrice,
  });
};

const handleWrapPolygonAction = async ({
  address,
  domain,
  obtId, // oracleId from FIO wrapped table
  manualSetGasPrice,
}) => {
  console.log(`POLYGON WRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`);

  await blockChainTransaction({
    action: ACTION_NAMES.WRAP_DOMAIN,
    chainName: POLYGON_CHAIN_NAME,
    contractActionParams: {
      domain,
      obtId,
      pubaddress: address,
    },
    logPrefix: 'POLYGON WRAP NPM MANUAL ',
    manualSetGasPrice,
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

  await blockChainTransaction({
    action: ACTION_NAMES.BURN_NFT,
    chainName: POLYGON_CHAIN_NAME,
    contractActionParams: {
      tokenId,
      obtId,
    },
    logPrefix: 'POLYGON BURNNFT NPM MANUAL ',
    manualSetGasPrice,
  });
};

export {
  handleWrapEthAction,
  handleWrapPolygonAction,
  handleUnwrapFromEthToFioChain,
  handleUnwrapFromPolygonToFioChain,
  handleBurnNFTInPolygon,
};
