import fetch from 'node-fetch';

export const getInfuraPolygonGasPrice = async () => {
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

export const getInfuraEthGasPrice = async () => {
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
