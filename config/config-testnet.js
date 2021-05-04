import contracts from './contracts_testnet';
const infuraProjectId = process.env.INFURA_PROJECT_ID;
export default {
    port: 3010,
    portMonitor: 20,
    web3Provider: `https://ropsten.infura.io/v3/${infuraProjectId}`,
    unsubscribeLandingPage: '',
    ownerAddress: '0xB7180670fc3e7a4Ccd8fE4bcBEcAe2bEaA7d92E0',
    startBlock: 0,
    stepSize: 10,
    waitingTime: 15,
    ...contracts
};
