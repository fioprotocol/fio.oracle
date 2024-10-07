import 'dotenv/config';
import Web3 from 'web3';
import cors from 'cors';
import express from 'express';

import {
  prepareLogDirectory,
  prepareLogFile,
  handleServerError,
  getLatestEthNonce,
  getLatestPolygonNonce,
} from './utils/log-files.js';

import {
  convertWeiToEth,
  convertWeiToGwei,
  getMiddleEthGasPriceSuggestion,
  getMiddlePolygonGasPriceSuggestion,
} from './utils/prices.js';

import { getLastIrreversibleBlockOnFioChain } from './utils/fio-chain.js';

import fioRoute from './routes/fio.js';
import fioCtrl from './api/fio.js';

import { LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME } from './constants/log-files.js';

import config from '../config/config.js';

const {
  gas: { USE_GAS_API },
  eth: { ETH_ORACLE_PUBLIC, BLOCKS_OFFSET_ETH },
  infura: { eth, polygon },
  mode,
  polygon: { POLYGON_ORACLE_PUBLIC },
  JOB_TIMEOUT,
} = config;

const route = express.Router();

class MainCtrl {
  async start(app) {
    const logPrefix = `Startup --> `;

    try {
      this.web3 = new Web3(eth);
      this.polyWeb3 = new Web3(polygon);

      // Check oracle addresses balances on ETH and Polygon chains
      await this.web3.eth.getBalance(
        ETH_ORACLE_PUBLIC,
        'latest',
        (error, result) => {
          if (error) {
            console.log(logPrefix + error.stack);
          } else {
            console.log(
              logPrefix +
                `Oracle ETH Address Balance: ${convertWeiToEth(result)} ETH`
            );
          }
        }
      );
      await this.polyWeb3.eth.getBalance(
        POLYGON_ORACLE_PUBLIC,
        'latest',
        (error, result) => {
          if (error) {
            console.log(logPrefix + error.stack);
          } else {
            console.log(
              logPrefix +
                `Oracle MATIC Address Balance: ${convertWeiToEth(result)} MATIC`
            );
          }
        }
      );

      // Check is INFURA_ETH and INFURA_POLYGON variables are valid
      const isUsingGasApi = !!parseInt(USE_GAS_API);
      if (isUsingGasApi) {
        const ethGasPriceSuggestion = await getMiddleEthGasPriceSuggestion();

        console.log(
          convertWeiToGwei(ethGasPriceSuggestion),
          'GWEI - safe gas price for ETH'
        );
        if (!ethGasPriceSuggestion)
          throw new Error(
            'Please, check "INFURA_ETH" variable: ' +
              JSON.stringify(ethGasPriceSuggestion)
          );
        const polyGasPriceSuggestion = await getMiddlePolygonGasPriceSuggestion();
        console.log(
          convertWeiToGwei(polyGasPriceSuggestion),
          'GWEI - safe gas price for Polygon'
        );
        if (!polyGasPriceSuggestion)
          throw new Error(
            'Please, check "INFURA_POLYGON" variable: ' +
              JSON.stringify(polyGasPriceSuggestion)
          );
      }

      // Prepare logs file
      prepareLogDirectory(LOG_DIRECTORY_PATH_NAME);
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.oracleErrors });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionErrorQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionErrorQueue,
      });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.FIO });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.ETH });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.MATIC });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions });

      console.log(logPrefix + 'logs folders are ready');

      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.fioOraclePosition });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.fioAddressPosition });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberFIO,
        fetchLastBlockNumber: getLastIrreversibleBlockOnFioChain,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT,
        fetchLastBlockNumber: getLastIrreversibleBlockOnFioChain,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH,
        fetchLastBlockNumber: this.web3.eth.getBlockNumber,
        offset: BLOCKS_OFFSET_ETH,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH,
        fetchLastBlockNumber: this.web3.eth.getBlockNumber,
        offset: BLOCKS_OFFSET_ETH,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon,
        fetchLastBlockNumber: this.polyWeb3.eth.getBlockNumber,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.ethNonce,
        fetchLastBlockNumber: getLatestEthNonce,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.polygonNonce,
        fetchLastBlockNumber: getLatestPolygonNonce,
      });
      console.log(logPrefix + 'blocks folders are ready');

      // Start Jobs asynchronously immediately
      fioCtrl.handleUnprocessedWrapActionsOnFioChain();
      fioCtrl.handleUnprocessedUnwrapActionsOnEthChainActions();
      fioCtrl.handleUnprocessedUnwrapActionsOnPolygon();
      fioCtrl.handleUnprocessedBurnNFTActions();

      // Start Jobs interval
      setInterval(fioCtrl.handleUnprocessedWrapActionsOnFioChain, parseInt(JOB_TIMEOUT)); //execute wrap FIO tokens and domains action every 60 seconds
      setInterval(fioCtrl.handleUnprocessedUnwrapActionsOnEthChainActions, parseInt(JOB_TIMEOUT)); //execute unwrap tokens and domains action every 60 seconds
      setInterval(fioCtrl.handleUnprocessedUnwrapActionsOnPolygon, parseInt(JOB_TIMEOUT)); //execute unwrap domains action every 60 seconds
      setInterval(
        fioCtrl.handleUnprocessedBurnNFTActions,
        parseInt(JOB_TIMEOUT)
      );

      this.initRoutes(app);

      console.log(logPrefix + `success`);
      console.log(logPrefix + `Mode: ${mode}`);
    } catch (err) {
      handleServerError(err, logPrefix);
      throw new Error(
        'In case failing any request, please, check env variables: INFURA_ETH, INFURA_POLYGON, JOB_TIMEOUT'
      );
    }
  }

    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();
