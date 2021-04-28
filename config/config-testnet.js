const infuraProjectId = process.env.INFURA_PROJECT_ID;
export default {
    port: 3010,
    portMonitor: 20,
    web3Provider: `https://ropsten.infura.io/v3/${infuraProjectId}`,
    unsubscribeLandingPage: '',
    startBlock: 0,
    stepSize: 10,
    waitingTime: 15,
};
