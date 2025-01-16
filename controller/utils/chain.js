import { Common, CustomChain, Hardfork } from '@ethereumjs/common';
import { Web3 } from 'web3';

import { Web3Service } from './web3-services.js';
import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioMaticNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import config from '../../config/config.js';
import { ACTION_NAMES } from '../constants/chain.js';

const {
  eth: { ETH_ORACLE_PUBLIC, ETH_CONTRACT, ETH_NFT_CONTRACT, ETH_CHAIN_NAME },
  infura: { eth, polygon },
  isTestnet,
  polygon: { POLYGON_ORACLE_PUBLIC, POLYGON_CONTRACT },
} = config;

import { POLYGON_TESTNET_CHAIN_ID } from '../constants/chain.js';

export const handlePolygonChainCommon = () => {
  if (isTestnet) {
    const customChainInstance = Common.custom(CustomChain.PolygonMumbai, {
      hardfork: Hardfork.London,
    });
    // Polygon Mumbai has been deprecated from 13th of April 2024.
    // Using Polygon Amoy instead but it's missing on CustomChain. So chainId and networkId should be updated
    customChainInstance._chainParams.chainId = POLYGON_TESTNET_CHAIN_ID;
    customChainInstance._chainParams.networkId = POLYGON_TESTNET_CHAIN_ID;

    return customChainInstance;
  }

  return Common.custom(CustomChain.PolygonMainnet, { hardfork: Hardfork.London });
};

export const handleEthChainCommon = () =>
  new Common({ chain: ETH_CHAIN_NAME, hardfork: Hardfork.London });

export const isOracleEthAddressValid = async (isTokens = true) => {
  const web3 = new Web3(eth);
  const contract = new web3.eth.Contract(
    isTokens ? fioABI : fioNftABI,
    isTokens ? ETH_CONTRACT : ETH_NFT_CONTRACT,
  );

  const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(ETH_ORACLE_PUBLIC.toLowerCase());
};

export const isOraclePolygonAddressValid = async () => {
  const web3 = new Web3(polygon);
  const contract = new web3.eth.Contract(fioMaticNftABI, POLYGON_CONTRACT);

  const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(POLYGON_ORACLE_PUBLIC.toLowerCase());
};

export const executeContractAction = ({
  actionName,
  amount,
  domain,
  obtId,
  pubaddress,
  tokenId,
}) => {
  let contractFunction = null;

  switch (actionName) {
    case ACTION_NAMES.WRAP_TOKENS: {
      const contract = Web3Service.getEthContract();
      contractFunction = contract.methods.wrap(pubaddress, amount, obtId);
      break;
    }
    case ACTION_NAMES.WRAP_DOMAIN: {
      const contract = Web3Service.getPolygonContract();
      contractFunction = contract.methods.wrapnft(pubaddress, domain, obtId);
      break;
    }
    case ACTION_NAMES.BURN_NFT: {
      const contract = Web3Service.getPolygonContract();
      contractFunction = contract.methods.burnnft(tokenId, obtId);
      break;
    }
    default:
      null;
  }

  if (!contractFunction) {
    throw Error('ExecuteContractAction has no contract function');
  }

  return contractFunction.encodeABI();
};

export const convertNativeFioIntoFio = (nativeFioValue) => {
  const fioDecimals = 1000000000;
  return parseInt(nativeFioValue + '') / fioDecimals;
};
