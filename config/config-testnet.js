import contracts from './contracts_testnet';
export default {
    port: 3010,
    portMonitor: 20,
    web3Provider: `https://ropsten.infura.io/v3/17e1f0782b604498bf68acdc9d1beb83`, //infura url
    polygonProvider: `https://rpc-mumbai.maticvigil.com/v1/be8edebd35298cc68689379e4efc21a401730797`,
    unsubscribeLandingPage: '',
    ownerAddress: '0xB7180670fc3e7a4Ccd8fE4bcBEcAe2bEaA7d92E0',
    startBlock: 0,
    stepSize: 10,
    waitingTime: 15,
    ...contracts
};
