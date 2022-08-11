import {re} from "mathjs";

require('dotenv').config();
import Web3 from 'web3';
const cors = require("cors");

import { convertWeiToEth, handleServerError, prepareLogDirectory, prepareLogFile } from "./helpers";

const route = require("express").Router();
import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import utilCtrl from './util';
import {LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME} from "./constants";
import config from "../config/config";

class MainCtrl {
    async start(app) {
        const logPrefix = `Startup --> `;
        try {
            this.web3 = new Web3(process.env.ETHINFURA);
            this.polyWeb3 = new Web3(process.env.POLYGON_INFURA);

            await this.web3.eth.getBalance(process.env.ETH_ORACLE_PUBLIC, 'latest', (error, result) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    console.log(logPrefix + `Oracle ETH Address Balance: ${convertWeiToEth(result)} ETH`)
                }
            })

            await this.polyWeb3.eth.getBalance(process.env.POLYGON_ORACLE_PUBLIC, 'latest', (error, result) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    console.log(logPrefix + `Oracle MATIC Address Balance: ${convertWeiToEth(result)} MATIC`)
                }
            })

            prepareLogDirectory(LOG_DIRECTORY_PATH_NAME);
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.oracleErrors });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.wrapDomainTransaction });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.wrapDomainTransactionError });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.wrapTokensTransaction });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.wrapTokensTransactionError });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.FIO });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.ETH });
            await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.MATIC });
            console.log(logPrefix + 'logs folders are ready');
            await prepareLogFile({
                filePath: LOG_FILES_PATH_NAMES.blockNumberFIO,
                fetchLastBlockNumber: utilCtrl.getInfo
            });
            await prepareLogFile({
                filePath: LOG_FILES_PATH_NAMES.blockNumberETH,
                fetchLastBlockNumber: this.web3.eth.getBlockNumber
            });
            await prepareLogFile({
                filePath: LOG_FILES_PATH_NAMES.blockNumberMATIC,
                fetchLastBlockNumber: this.polyWeb3.eth.getBlockNumber
            });
            console.log(logPrefix + 'blocks folders are ready');

            // ethCtrl.getContract();
            setInterval(fioCtrl.handleUnprocessedWrapActions, parseInt(process.env.POLLTIME)); //excute wrap action every 60 seconds
            setInterval(fioCtrl.handleUnprocessedUnwrapTokensActions, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            // setInterval(fioCtrl.unwrapDomainFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            setInterval(fioCtrl.handleUnprocessedUnwrapDomainActionsOnPolygon, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds

            this.initRoutes(app);

            console.log(logPrefix + `success`)
            console.log(logPrefix + `Mode: ${process.env.MODE}`)
        } catch (err) {
            handleServerError(err, logPrefix);
            throw new Error('In case failing any request, please, check env variables: ETHINFURA, POLYGON_INFURA, POLLTIME');
        }
    }

    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();
