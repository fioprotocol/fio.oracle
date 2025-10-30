import fetch from 'node-fetch';

export const getInfuraGasPrice = async ({ infura, chainCode }) => {
  const { rpcUrl, apiKey } = infura || {};

  const errorLogPrefix = `INFURA ERROR[Get gas price] chain [${chainCode}]:`;

  if (!rpcUrl) {
    throw new Error(`${errorLogPrefix} RPC URL is required'`);
  }
  if (!apiKey) {
    throw new Error(`${errorLogPrefix} API KEY is required`);
  }

  const url = `${rpcUrl}/${apiKey}`;

  try {
    const gasPriceSuggestion = await (
      await fetch(url, {
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
  } catch (error) {
    console.error(`${errorLogPrefix} ${error}`);
    throw error;
  }
};
