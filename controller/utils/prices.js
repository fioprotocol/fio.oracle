import fetch from 'node-fetch';
import Web3 from 'web3';
import fs from 'fs';

export const convertWeiToGwei = (weiValue) => {
  return parseFloat(
    Web3.utils.fromWei(
      typeof weiValue === 'number' ? weiValue + '' : weiValue,
      'gwei'
    )
  );
};

export const convertGweiToWei = (gweiValue) => {
  return parseFloat(Web3.utils.toWei(gweiValue, 'gwei'));
};

export const convertWeiToEth = (weiValue) => {
  return parseFloat(
    Web3.utils.fromWei(
      typeof weiValue === 'number' ? weiValue + '' : weiValue,
      'ether'
    )
  );
};

// POLYGON gas price suggestion in WEI
export const getPolygonGasPriceSuggestion = async () => { // todo add more providers
  const gasPriceSuggestion = await (
    await fetch(process.env.POLYGON_INFURA, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
      method: 'POST',
    })
  ).json();

  let value = null;

  if (gasPriceSuggestion && gasPriceSuggestion.result) {
    value = parseInt(gasPriceSuggestion.result);
  }

  return value;
};

// ETH gas price suggestion in WEI
export const getEthGasPriceSuggestion = async () => {
  const gasPriceSuggestion = await (
    await fetch(process.env.ETHINFURA, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
      method: 'POST',
    })
  ).json();

  let value = null;

  if (gasPriceSuggestion && gasPriceSuggestion.result) {
    value = parseInt(gasPriceSuggestion.result);
  }

  return value;
};

// base gas price value + 10%
const calculateAverageGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * 1.1);
};

// base gas price value + 20%
const calculateHighGasPrice = (baseGasPrice) => {
  return Math.ceil(baseGasPrice * 1.2);
};

export const getGasPrice = async ({
  defaultGasPrice,
  getGasPriceSuggestionFn,
  logPrefix,
}) => {
  const isUsingGasApi = !!parseInt(process.env.USEGASAPI);

  let gasPrice = 0;

  if (isUsingGasApi && getGasPriceSuggestionFn) {
    console.log(`${logPrefix} using gasPrice value from the api:`);

    const gasPriceSuggestion = await getGasPriceSuggestionFn();

    switch (process.env.GASPRICELEVEL) {
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
    gasPrice = convertGweiToWei(defaultGasPrice);
  }

  if (!gasPrice || parseInt(defaultGasPrice) <= 0)
    throw new Error(`${logPrefix} Cannot set valid Gas Price value`);

  console.log(
    `${logPrefix} gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI)`
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
      if (
        convertWeiToEth(walletBalance) <
        convertWeiToEth(gasLimit * gasPrice) * 5
      ) {
        const timeStamp = new Date().toISOString();
        console.log(
          `${logPrefix} Warning: Low Oracle ${chainName} Address Balance: ${convertWeiToEth(
            walletBalance
          )} ${tokenCode}`
        );
        fs.writeFile(
          LOG_FILES_PATH_NAMES.oracleErrors,
          `${timeStamp} ${logPrefix} Warning: Low Oracle ${chainName} Address Balance: ${convertWeiToEth(
            walletBalance
          )} ${tokenCode}`
        );
      }
    }
  });
};
