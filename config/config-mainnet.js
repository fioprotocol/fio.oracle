import contracts from './contracts_mainnet';

export default {
  port: 3002,
  portMonitor: 15,
  web3Provider: "",
  unsubscribeLandingPage: '',
  startBlock: 0,
  stepSize: 10,
  waitingTime: 15,
  ...contracts
};