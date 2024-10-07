import fetch from 'node-fetch';

import config from '../../config/config.js';

const {
  infura: { eth, polygon },
} = config;

export const getInfuraPolygonGasPrice = async () => {
  const gasPriceSuggestion = await (
    await fetch(polygon, {
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

export const getInfuraEthGasPrice = async () => {
  const gasPriceSuggestion = await (
    await fetch(eth, {
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
