import { createThirdwebClient } from 'thirdweb';
import * as thirdwebChains from 'thirdweb/chains';
import { getRpcClient, eth_gasPrice } from 'thirdweb/rpc';

import config from '../../config/config.js';

const {
  web3Providers: {
    thirdweb: { API_KEY: THIRDWEB_API_KEY },
  },
} = config;

const client = createThirdwebClient({
  secretKey: THIRDWEB_API_KEY,
});

const getChainRpcRequest = (chain) => getRpcClient({ client, chain });
const getChainGasPrice = async (chainRpcRequest) =>
  await eth_gasPrice(chainRpcRequest, {});

export const getThirdWebGasPrice = async ({ chainName, thirdweb }) => {
  const { chainName: thirdWebChainName } = thirdweb || {};

  const errorLogPrefix = `THIRDWEB ERROR [Get gas price] chain [${chainName}]:`;

  if (!thirdWebChainName) {
    throw new Error(`${errorLogPrefix} Chain name is required`);
  }

  try {
    const chainRpcRequest = getChainRpcRequest(thirdwebChains[thirdWebChainName]);

    const gasPrice = await getChainGasPrice(chainRpcRequest);
    return gasPrice ? parseInt(gasPrice) : gasPrice;
  } catch (error) {
    console.error(`${errorLogPrefix} ${error}`);
    throw error;
  }
};
