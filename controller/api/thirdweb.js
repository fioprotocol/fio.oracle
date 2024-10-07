import { getRpcClient, eth_gasPrice } from 'thirdweb/rpc';
import { createThirdwebClient } from 'thirdweb';
import { ethereum, sepolia, polygon, polygonAmoy } from 'thirdweb/chains';

import config from '../../config/config.js';

const {
  isTestnet,
  thirdWeb: { THIRDWEB_API_KEY },
} = config;

const client = createThirdwebClient({
  secretKey: THIRDWEB_API_KEY,
});

const getChainRpcRequest = (chain) => getRpcClient({ client, chain });
const getChainGasPrice = async (chainRpcRequest) => await eth_gasPrice(chainRpcRequest, {});

const testnetEthereumRpcRequest = () => getChainRpcRequest(sepolia);
const mainnetEthereumRpcRequest = () => getChainRpcRequest(ethereum);

const testnetPolygonRpcRequest = () => getChainRpcRequest(polygonAmoy);
const mainnetPolygonRpcRequest = () => getChainRpcRequest(polygon);

export const getThirdwebEthGasPrice = async () => {
  const chainRpcRequest = isTestnet ? testnetEthereumRpcRequest(): mainnetEthereumRpcRequest();

  const gasPrice = await getChainGasPrice(chainRpcRequest);
  return gasPrice ? parseInt(gasPrice) : gasPrice;
};

export const getThirdwebPolygonGasPrice = async () => {
  const chainRpcRequest = isTestnet ? testnetPolygonRpcRequest() : mainnetPolygonRpcRequest(); 

  const gasPrice = await getChainGasPrice(chainRpcRequest);
  return gasPrice ? parseInt(gasPrice) : gasPrice;
};

