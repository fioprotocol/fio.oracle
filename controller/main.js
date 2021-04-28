import fioRoute from './routes/fio';
const cors = require("cors");
const route = require("express").Router();

class MainCtrl {
    async start(app) {
        this.initRoutes(app);
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();