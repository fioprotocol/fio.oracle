require('dotenv').config();
import Web3 from 'web3';
const cors = require("cors");

import {
    convertNativeFioIntoFio,
    convertWeiToEth,
    handleServerError,
    prepareLogDirectory,
    prepareLogFile
} from "./helpers";

const route = require("express").Router();
import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import utilCtrl from './util';
import {LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME} from "./constants";
import fetch from "node-fetch";

class MainCtrl {
    async start(app) {
        const logPrefix = `Startup --> `;
        try {
            this.web3 = new Web3(process.env.ETHINFURA);
            this.polyWeb3 = new Web3(process.env.POLYGON_INFURA);

            // Check oracle addresses balances on ETH and Polygon chains
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

            // Check is ETH_API_URL and POLYGON_API_URL variables are valid
            const gasMode = process.env.USEGASAPI;
            if (gasMode === "1") {
                const ethGasPriceSuggestions = await (await fetch(process.env.ETH_API_URL)).json();
                if (ethGasPriceSuggestions.status !== "1") throw new Error('Please, check "ETH_API_URL" variable: ' + JSON.stringify(ethGasPriceSuggestions))
                const polyGasPriceSuggestions = await (await fetch(process.env.POLYGON_API_URL)).json();
                if (polyGasPriceSuggestions.status !== "1") throw new Error('Please, check "POLYGON_API_URL" variable: ' + JSON.stringify(polyGasPriceSuggestions))

            }

            // Prepare logs files
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

            // Start Jobs
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
            throw new Error('In case failing any request, please, check env variables: ETHINFURA, POLYGON_INFURA, POLLTIME, ETH_API_URL, POLYGON_API_URL');
        }
    }

    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();
