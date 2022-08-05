require('dotenv').config();
import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import utilCtrl from './util';
import Web3 from 'web3';
import {handleServerError, logDir, prepareLogDirectory, prepareLogFile} from "./helpers";
import process from "process";
const cors = require("cors");

const route = require("express").Router();
const pathFIO = logDir + "FIO.log";//log events and errors on FIO side
const pathETH = logDir + "ETH.log";//log events and errors on ETH side
const pathMATIC = logDir + "MATIC.log";
const blockNumFIO = logDir + "blockNumberFIO.log";//store FIO blockNumber for the wrapAction
const blockNumETH = logDir + "blockNumberETH.log";//store ETH blockNumber for the unwrapAction
const blockNumMATIC = logDir + "blockNumberMATIC.log";//store ETH blockNumber for the unwrapAction

const WrapTransaction = logDir + "WrapTransaction.log";//store fio transaction data for wrapAction
const WrapErrTransaction = logDir + "WrapErrTransaction.log";//store unprocessed fio transaction data for resubmit
const serverErrLogsPathname = logDir + "Error.log";//store the error startup and else unexpected errors error
const pathDomainWrapTransact = logDir + "DomainWrapTransaction.log";
const domainWrapErrTransaction = logDir + "DomainWrapErrTransaction.log";

class MainCtrl {
    async start(app) {
        try {
            this.web3 = new Web3(process.env.ETHINFURA);
            this.polyWeb3 = new Web3(process.env.POLYGON_INFURA);

            prepareLogDirectory(logDir);
            await prepareLogFile({ filePath: serverErrLogsPathname });
            await prepareLogFile({ filePath: pathDomainWrapTransact });
            await prepareLogFile({ filePath: domainWrapErrTransaction });
            await prepareLogFile({ filePath: WrapTransaction });
            await prepareLogFile({ filePath: WrapErrTransaction });
            await prepareLogFile({ filePath: pathFIO });
            await prepareLogFile({ filePath: pathETH });
            await prepareLogFile({ filePath: pathMATIC });
            console.log('Startup: logs folders is ready');
            await prepareLogFile({
                filePath: blockNumFIO,
                blockName: 'lastBlockNumber',
                fetchLastBlockNumber: utilCtrl.getInfo
            });
            await prepareLogFile({
                filePath: blockNumETH,
                blockName: 'ethBlockNumber',
                fetchLastBlockNumber: this.web3.eth.getBlockNumber
            });
            await prepareLogFile({
                filePath: blockNumMATIC,
                blockName: 'polygonBlockNumber',
                fetchLastBlockNumber: this.polyWeb3.eth.getBlockNumber
            });
            console.log('Startup: blocks folders is ready');

            // ethCtrl.getContract();
            setInterval(fioCtrl.getLatestDomainWrapAction, parseInt(process.env.POLLTIME)); //excute wrap action every 60 seconds
            setInterval(fioCtrl.getLatestWrapAction, parseInt(process.env.POLLTIME)); //excute wrap action every 60 seconds
            setInterval(fioCtrl.unwrapTokens, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            // setInterval(fioCtrl.unwrapDomainFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            setInterval(fioCtrl.unwrapPolygonDomainFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds

            this.initRoutes(app);

            console.log(`Startup: success`)
            console.log(`Mode: ${process.env.MODE}`)
        } catch (err) {
            handleServerError(err, 'Startup');
            throw new Error('In case failing any request, please, check env variables: ETHINFURA, POLYGON_INFURA, FIO_ORACLE_ADDRESS, POLLTIME');
        }
    }

    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();
