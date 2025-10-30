import 'dotenv/config';

import config from '../config/config.js';
import { ACTIONS, FIO_CONTRACT_ACTIONS } from '../controller/constants/chain.js';

import { runUnwrapFioTransaction } from '../controller/utils/fio-chain.js';

import { blockChainTransaction } from '../controller/utils/transactions.js';
import { Web3Service } from '../controller/utils/web3-services.js';

const { supportedChains } = config;

export const handleWrapAction = async ({
  action,
  address,
  amount,
  chainCode,
  nftName,
  obtId,
  manualSetGasPrice,
  type,
}) => {
  const logPrefix = `[MANUAL RUN] ${chainCode} ${action} ${type} --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `nftName: ${nftName}`}`;

  const currentChain = supportedChains[type].find(
    (chain) => chain.chainCode === chainCode,
  );
  const { contractAddress, infura } = currentChain;

  const contract = Web3Service.getWeb3Contract({
    apiKey: infura.apiKey,
    type,
    chainCode,
    contractAddress,
    rpcUrl: infura.rpcUrl,
  });

  await blockChainTransaction({
    action,
    chainCode,
    contract,
    contractActionParams: {
      amount,
      obtId,
      nftName,
      pubaddress: address,
    },
    manualSetGasPrice,
    logPrefix,
    type,
  });
};

export const handleUnwrapAction = async ({
  action,
  address,
  amount,
  chainCode,
  nftName,
  obtId,
  type,
}) => {
  const logPrefix = `[MANUAL RUN] ${chainCode} ${action} ${type} --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `nftName: ${nftName}`}`;

  console.log(logPrefix);

  const actionName = FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][type];

  const transactionActionData = {
    fio_address: address,
    obt_id: obtId,
  };

  if (amount) {
    transactionActionData.amount = parseInt(amount);
  } else if (nftName) {
    transactionActionData.fio_domain = nftName;
  }

  const transactionResult = await runUnwrapFioTransaction({
    actionName,
    transactionActionData,
  });

  if (!(transactionResult.type || transactionResult.error)) {
    console.log(`Completed:`);
  } else console.log(`Error:`);

  console.log(transactionResult);
};

export const handleBurnNFTInPolygon = async ({
  action,
  chainCode,
  obtId,
  tokenId,
  manualSetGasPrice,
  type,
}) => {
  const logPrefix = `[MANUAL RUN] ${chainCode} ${action} ${type} --> obtId: ${obtId}, tokenID: ${tokenId}`;

  const actionName = FIO_CONTRACT_ACTIONS[ACTIONS.BURN];

  const currentChain = supportedChains[type].find(
    (chain) => chain.chainCode === chainCode,
  );
  const { contractAddress, infura } = currentChain;

  const contract = Web3Service.getWeb3Contract({
    apiKey: infura.apiKey,
    type,
    chainCode,
    contractAddress,
    rpcUrl: infura.rpcUrl,
  });

  await blockChainTransaction({
    action: actionName,
    chainCode,
    contract,
    contractActionParams: {
      tokenId,
      obtId,
    },
    logPrefix,
    manualSetGasPrice,
    type,
  });
};
