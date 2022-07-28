require('dotenv').config();

export default {
    port: process.env.PORT,
    portMonitor: process.env.PORT_MONITOR,
    unsubscribeLandingPage: '',
    FIO_token: process.env.ETH_TOKEN_CONTRACT,
    FIO_NFT: process.env.ETH_NFT_CONTRACT,
    FIO_NFT_POLYGON: process.env.POLYGON_NFT_CONTRACT,
};
