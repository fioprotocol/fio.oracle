import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import ethCtrl from './api/eth';
import utilCtrl from './util';
import config from '../config/config';
import Web3 from 'web3';
// import util from './util';
const fs = require('fs');
const cors = require('cors');
const route = require('express').Router();
class MainCtrl {
    async start(app) {
        const lastBlockNum = await utilCtrl.getInfo();
        try {
            const lastProcessed = fs.readFileSync('controller/api/logs/blockNumber.log', 'utf8');
            config.oracleCache.set( "lastBlockNumber", parseInt(lastProcessed), 10000 );
        } catch (err) {
            console.error(err)
        }
        this.web3 = new Web3(config.web3Provider);
        this.web3.eth.getBlockNumber()
        .then((number)=>{
            config.oracleCache.set( "ethBlockNumber", number, 10000 );
        })
        utilCtrl.availCheck("bp1@dapixdev");
        // ethCtrl.getContract();
        // ethCtrl.wrapFunction();
        setInterval(fioCtrl.wrapFunction, parseInt(process.env.POLLTIME));
        setInterval(fioCtrl.unwrapFunction, parseInt(process.env.POLLTIME));

        this.initRoutes(app);
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();