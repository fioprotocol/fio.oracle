import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import ethCtrl from './api/eth';
import utilCtrl from './util';
import config from '../config/config';
import Web3 from "web3";
import util from './util';
const cors = require("cors");
const route = require("express").Router();
class MainCtrl {
    async start(app) {
        config.oracleCache.set( "actionIndex", 52, 10000 );
        this.web3 = new Web3(config.web3Provider);
        this.web3.eth.getBlockNumber()
        .then((number)=>{
            config.oracleCache.set( "ethBlockNumber", number, 10000 );
        })
        utilCtrl.availCheck("bp1@dapixdev");
        // ethCtrl.getContract();
        // ethCtrl.wrapFunction();
        // setInterval(fioCtrl.wrapFunction,5000);
        // setInterval(fioCtrl.unwrapFunction,5000);

        this.initRoutes(app);
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();