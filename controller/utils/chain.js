import { Common, CustomChain } from '@ethereumjs/common';
import Web3 from 'web3';

import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import fioMaticNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import config from '../../config/config.js';

const {
  eth: { ETH_ORACLE_PUBLIC, ETH_CONTRACT, ETH_NFT_CONTRACT, ETH_CHAIN_NAME },
  infura: { eth, polygon },
  isTestnet,
  polygon: { POLYGON_ORACLE_PUBLIC, POLYGON_CONTRACT },
} = config;

import { POLYGON_TESTNET_CHAIN_ID } from '../constants/chain.js';

export const handlePolygonChainCommon = () => {
  if (isTestnet) {
    const customChainInstance = Common.custom(CustomChain.PolygonMumbai);
    // Polygon Mumbai has been deprecated from 13th of April 2024.
    // Using Polygon Amoy instead but it's missing on CustomChain. So chainId and networkId should be updated
    customChainInstance._chainParams.chainId = POLYGON_TESTNET_CHAIN_ID;
    customChainInstance._chainParams.networkId = POLYGON_TESTNET_CHAIN_ID;

    return customChainInstance;
  }

  return Common.custom(CustomChain.PolygonMainnet);
};

export const handleEthChainCommon = () => new Common({ chain: ETH_CHAIN_NAME })

export const isOracleEthAddressValid = async (isTokens = true) => {
  const web3 = new Web3(eth);
  const contract = new web3.eth.Contract(
    isTokens ? fioABI : fioNftABI,
    isTokens
      ? ETH_CONTRACT
      : ETH_NFT_CONTRACT
  );

  const registeredOraclesPublicKeys = await contract.methods
    .getOracles()
    .call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(ETH_ORACLE_PUBLIC.toLowerCase());
};

export const isOraclePolygonAddressValid = async () => {
  const web3 = new Web3(polygon);
  const contract = new web3.eth.Contract(
    fioMaticNftABI,
    POLYGON_CONTRACT
  );

  const registeredOraclesPublicKeys = await contract.methods
    .getOracles()
    .call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(POLYGON_ORACLE_PUBLIC.toLowerCase());
};

export const convertNativeFioIntoFio = (nativeFioValue) => {
  const fioDecimals = 1000000000;
  return parseInt(nativeFioValue + '') / fioDecimals;
};
