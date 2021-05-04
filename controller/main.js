import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import ethCtrl from './api/eth';
import config from '../config/config';
const cors = require("cors");
const route = require("express").Router();
class MainCtrl {
    async start(app) {
        config.oracleCache.set( "actionIndex", 42, 10000 );
        ethCtrl.wrapFunction();
        setInterval(fioCtrl.getActions,5000);
        this.initRoutes(app);
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();