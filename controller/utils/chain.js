import { Common, CustomChain, Hardfork } from '@ethereumjs/common';

import { Web3Service } from './web3-services.js';
import config from '../../config/config.js';
import { ACTION_NAMES } from '../constants/chain.js';

const {
  eth: { ETH_ORACLE_PUBLIC, ETH_CHAIN_NAME },
  isTestnet,
  polygon: { POLYGON_ORACLE_PUBLIC },
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

export const isOracleEthAddressValid = async () => {
  const contract = Web3Service.getEthContract();

  const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(ETH_ORACLE_PUBLIC.toLowerCase());
};

export const isOraclePolygonAddressValid = async () => {
  const contract = Web3Service.getPolygonContract();

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
