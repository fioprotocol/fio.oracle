require('dotenv').config();

export default {
    port: process.env.PORT,
    unsubscribeLandingPage: '',
    FIO_token: process.env.FIO_TOKEN_ETH_CONTRACT,
    FIO_NFT_ETH_CONTRACT: process.env.FIO_NFT_ETH_CONTRACT,
    FIO_NFT_POLYGON_CONTRACT: process.env.FIO_NFT_POLYGON_CONTRACT,
};
