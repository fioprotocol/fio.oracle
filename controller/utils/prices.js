import fs from 'fs';

import Web3 from 'web3';

import config from '../../config/config.js';
import { getInfuraPolygonGasPrice, getInfuraEthGasPrice } from '../api/infura.js';
import { getMoralisEthGasPrice, getMoralisPolygonGasPrice } from '../api/moralis.js';
import { getThirdwebEthGasPrice, getThirdwebPolygonGasPrice } from '../api/thirdweb.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';

const {
  gas: { USE_GAS_API, GAS_PRICE_LEVEL },
} = config;

export const convertWeiToGwei = (weiValue) => {
  return parseFloat(
    Web3.utils.fromWei(typeof weiValue === 'number' ? weiValue + '' : weiValue, 'gwei'),
  );
};

export const convertGweiToWei = (gweiValue) => {
  return parseFloat(Web3.utils.toWei(gweiValue, 'gwei'));
};

export const convertWeiToEth = (weiValue) => {
  return parseFloat(
    Web3.utils.fromWei(typeof weiValue === 'number' ? weiValue + '' : weiValue, 'ether'),
  );
};

const handleSuggestedGasPrices = async (gasPricePromises) => {
  const suggestedGasPricesPromises = await Promise.allSettled(gasPricePromises);

  const resolvedGasPricesResults = suggestedGasPricesPromises
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  return resolvedGasPricesResults;
};

// POLYGON gas price suggestion in WEI
export const getPolygonGasPriceSuggestion = async () =>
  handleSuggestedGasPrices([
    getInfuraPolygonGasPrice(),
    getThirdwebPolygonGasPrice(),
    getMoralisPolygonGasPrice(),
  ]);

// ETH gas price suggestion in WEI
export const getEthGasPriceSuggestion = async () => {
  return handleSuggestedGasPrices([
    getInfuraEthGasPrice(),
    getThirdwebEthGasPrice(),
    getMoralisEthGasPrice(),
  ]);
};

// base gas price value + 10%
const calculateAverageGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * 1.1);
};

// base gas price value + 20%
const calculateHighGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * 1.2);
};

const getMiddleGasPriceValue = (gasPriceSuggestions) => {
  let gasPriceSuggestion = null;
  const numSuggestions = gasPriceSuggestions.length;

  switch (numSuggestions) {
    case 1:
      gasPriceSuggestion = gasPriceSuggestions[0];
      break;
    case 2:
      gasPriceSuggestion = Math.max(...gasPriceSuggestions);
      break;
    case 3: {
      gasPriceSuggestions.sort((a, b) => a - b);
      gasPriceSuggestion = gasPriceSuggestions[1];
      break;
    }
    default: {
      gasPriceSuggestion = gasPriceSuggestions[0];
    }
  }

  return gasPriceSuggestion;
};

export const getMiddleEthGasPriceSuggestion = async () => {
  const ethGasPriceSuggestions = await getEthGasPriceSuggestion();

  return getMiddleGasPriceValue(ethGasPriceSuggestions);
};

export const getMiddlePolygonGasPriceSuggestion = async () => {
  const polygonGasPriceSuggestions = await getPolygonGasPriceSuggestion();

  return getMiddleGasPriceValue(polygonGasPriceSuggestions);
};

export const getGasPrice = async ({
  defaultGasPrice,
  getGasPriceSuggestionFn,
  logPrefix,
  retryCount,
}) => {
  const isUsingGasApi = !!parseInt(USE_GAS_API);

  let gasPrice = 0;
  let gasPriceSuggestion = 0;

  if (isUsingGasApi && getGasPriceSuggestionFn) {
    console.log(`${logPrefix} using gasPrice value from the api:`);

    const gasPriceSuggestions = await getGasPriceSuggestionFn();

    const numSuggestions = gasPriceSuggestions.length;

    switch (numSuggestions) {
      case 1:
        gasPriceSuggestion = gasPriceSuggestions[0];
        break;
      case 2:
        gasPriceSuggestion = Math.max(...gasPriceSuggestions);
        break;
      case 3: {
        if (retryCount === 0) {
          gasPriceSuggestions.sort((a, b) => a - b);
          gasPriceSuggestion = gasPriceSuggestions[1];
        } else if (retryCount > 0) {
          gasPriceSuggestion = Math.max(...gasPriceSuggestions);
        }
        break;
      }
      default: {
        gasPriceSuggestion = gasPriceSuggestions[0];
      }
    }

    switch (GAS_PRICE_LEVEL) {
      case 'low':
        gasPrice = gasPriceSuggestion;
        break;
      case 'average':
        gasPrice = calculateAverageGasPrice(gasPriceSuggestion);
        break;
      case 'high':
        gasPrice = calculateHighGasPrice(gasPriceSuggestion);
        break;
      default:
        gasPrice = gasPriceSuggestion;
    }
  } else if (!isUsingGasApi || !getGasPriceSuggestionFn) {
    console.log(`${logPrefix} Using gasPrice value from the .env:`);
    gasPrice = convertGweiToWei(defaultGasPrice.toString());
  }

  if (!gasPrice || parseInt(defaultGasPrice) <= 0)
    throw new Error(`${logPrefix} Cannot set valid Gas Price value`);

  console.log(
    `${logPrefix} gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice.toString())} GWEI)`,
  );

  return gasPrice;
};

export const getWeb3Balance = async ({
  chainName,
  gasLimit,
  gasPrice,
  logPrefix,
  publicKey,
  tokenCode,
  web3Instance,
}) => {
  web3Instance.eth.getBalance(publicKey, 'latest', (error, walletBalance) => {
    if (error) {
      console.log(logPrefix + error.stack);
    } else {
      if (convertWeiToEth(walletBalance) < convertWeiToEth(gasLimit * gasPrice) * 5) {
        const timeStamp = new Date().toISOString();
        console.log(
          `${logPrefix} Warning: Low Oracle ${chainName} Address Balance: ${convertWeiToEth(
            walletBalance,
          )} ${tokenCode}`,
        );
        fs.writeFile(
          LOG_FILES_PATH_NAMES.oracleErrors,
          `${timeStamp} ${logPrefix} Warning: Low Oracle ${chainName} Address Balance: ${convertWeiToEth(
            walletBalance,
          )} ${tokenCode}`,
          () => {},
        );
      }
    }
  });
};
