require('dotenv').config();

export default {
  port: process.env.PORT, //3002
  portMonitor: process.env.PORT_MONITOR, // 15
  web3Provider: "",
  unsubscribeLandingPage: '',
  FIO_token: process.env.ETH_TOKEN_CONTRACT,
  FIO_NFT: process.env.ETH_NFT_CONTRACT,
  FIO_NFT_POLYGON: process.env.POLYGON_NFT_CONTRACT,
};
