import fs from 'fs';

import { Web3 } from 'web3';

import { LOG_FILES_KEYS, getLogFilePath } from './log-file-templates.js';
import config from '../../config/config.js';
import { getInfuraGasPrice } from '../api/infura.js';
import { getMoralisGasPrice } from '../api/moralis.js';
import { getThirdWebGasPrice } from '../api/thirdweb.js';
import { GAS_PRICE_MULTIPLIERS } from '../constants/prices.js';

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

// Gas price suggestion in WEI
export const getGasPriceSuggestion = async ({ chainCode, infura, moralis, thirdweb }) => {
  return handleSuggestedGasPrices([
    getInfuraGasPrice({ chainCode, infura }),
    getThirdWebGasPrice({ chainCode, thirdweb }),
    getMoralisGasPrice({ chainCode, moralis }),
  ]);
};

// base gas price value + 20%
const calculateAverageGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * GAS_PRICE_MULTIPLIERS.AVERAGE);
};

// base gas price value + 40%
const calculateHighGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * GAS_PRICE_MULTIPLIERS.HIGH);
};

const getHighestGasPriceValue = (gasPriceSuggestions) => Math.max(...gasPriceSuggestions);

export const getHighestGasPriceSuggestion = async ({
  chainCode,
  infura,
  moralis,
  thirdweb,
}) => {
  const gasPriceSuggestions = await getGasPriceSuggestion({
    chainCode,
    infura,
    moralis,
    thirdweb,
  });

  return getHighestGasPriceValue(gasPriceSuggestions);
};

export const getGasPrice = async ({
  defaultGasPrice,
  getGasPriceSuggestionFn,
  logPrefix,
  isRetry = false,
  isReplace = false,
}) => {
  const isUsingGasApi = !!parseInt(USE_GAS_API);

  let gasPrice = 0;
  let finalMultiplier = 1;

  if (isUsingGasApi && getGasPriceSuggestionFn) {
    console.log(`${logPrefix} using gasPrice value from the api:`);

    const gasPriceSuggestions = await getGasPriceSuggestionFn();

    const baseGasPrice = getHighestGasPriceValue(gasPriceSuggestions);

    switch (GAS_PRICE_LEVEL) {
      case 'low':
        gasPrice = baseGasPrice;
        break;
      case 'average':
        gasPrice = calculateAverageGasPrice(baseGasPrice);
        break;
      case 'high':
        gasPrice = calculateHighGasPrice(baseGasPrice);
        break;
      default:
        gasPrice = baseGasPrice;
    }

    // Apply additional multipliers if needed
    if (isReplace) {
      finalMultiplier = GAS_PRICE_MULTIPLIERS.REPLACEMENT;
      gasPrice = Math.ceil(gasPrice * finalMultiplier);
      console.log(`${logPrefix} Applied replace multiplier (${finalMultiplier}x)`);
    } else if (isRetry) {
      finalMultiplier = GAS_PRICE_MULTIPLIERS.RETRY;
      gasPrice = Math.ceil(gasPrice * finalMultiplier);
      console.log(`${logPrefix} Applied retry multiplier (${finalMultiplier}x)`);
    }
  } else if (!isUsingGasApi || !getGasPriceSuggestionFn) {
    console.log(`${logPrefix} Using gasPrice value from the .env:`);
    gasPrice = convertGweiToWei(defaultGasPrice.toString());

    if (isReplace || isRetry) {
      const multiplier = isReplace
        ? GAS_PRICE_MULTIPLIERS.REPLACEMENT
        : GAS_PRICE_MULTIPLIERS.RETRY;
      gasPrice = Math.ceil(gasPrice * multiplier);
      console.log(
        `${logPrefix} Applied ${isReplace ? 'replace' : 'retry'} multiplier (${multiplier}x)`,
      );
    }
  }

  if (!gasPrice || parseInt(defaultGasPrice) <= 0)
    throw new Error(`${logPrefix} Cannot set valid Gas Price value`);

  console.log(
    `${logPrefix} gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice.toString())} GWEI)`,
  );

  return gasPrice;
};

export const getWeb3Balance = async ({
  chainCode,
  gasLimit,
  gasPrice,
  logPrefix,
  publicKey,
  web3Instance,
}) => {
  web3Instance.eth.getBalance(publicKey, 'latest', (error, walletBalance) => {
    if (error) {
      console.log(`${logPrefix} ${error.stack}`);
    } else {
      if (convertWeiToEth(walletBalance) < convertWeiToEth(gasLimit * gasPrice) * 5) {
        const timeStamp = new Date().toISOString();
        console.log(
          `${logPrefix} Warning: Low Oracle ${chainCode} Address Balance: ${convertWeiToEth(
            walletBalance,
          )} ${chainCode}`,
        );
        fs.writeFile(
          getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }),
          `${timeStamp} ${logPrefix} Warning: Low Oracle ${chainCode} Address Balance: ${convertWeiToEth(
            walletBalance,
          )} ${chainCode}`,
          () => {},
        );
      }
    }
  });
};
