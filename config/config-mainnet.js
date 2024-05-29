import 'dotenv/config';

export default {
  port: process.env.PORT, //3002
  web3Provider: "",
  unsubscribeLandingPage: '',
  FIO_token: process.env.FIO_TOKEN_ETH_CONTRACT,
  FIO_NFT_ETH_CONTRACT: process.env.FIO_NFT_ETH_CONTRACT,
  FIO_NFT_POLYGON_CONTRACT: process.env.FIO_NFT_POLYGON_CONTRACT,
  MORALIS_RPC_NODE_API_KEY_ETHEREUM: process.env.MORALIS_RPC_NODE_API_KEY_ETHEREUM_MAINNET,
  MORALIS_RPC_NODE_API_KEY_POLYGON: process.env.MORALIS_RPC_NODE_API_KEY_POLYGON_MAINNET,
};
