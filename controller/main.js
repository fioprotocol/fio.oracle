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
  getEthGasPriceSuggestion,
  getPolygonGasPriceSuggestion,
} from './utils/prices.js';

import { getLastIrreversibleBlockOnFioChain } from './utils/fio-chain.js';

import fioRoute from './routes/fio.js';
import fioCtrl from './api/fio.js';

import { LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME } from './constants/log-files.js';

const route = express.Router();

class MainCtrl {
  async start(app) {
    const logPrefix = `Startup --> `;

    try {
      this.web3 = new Web3(process.env.ETHINFURA);
      this.polyWeb3 = new Web3(process.env.POLYGON_INFURA);

      // Check oracle addresses balances on ETH and Polygon chains
      await this.web3.eth.getBalance(
        process.env.ETH_ORACLE_PUBLIC,
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
        process.env.POLYGON_ORACLE_PUBLIC,
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

      // Check is ETHINFURA and POLYGON_INFURA variables are valid
      const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
      if (isUsingGasApi) {
        const ethGasPriceSuggestion = await getEthGasPriceSuggestion();
        console.log(
          convertWeiToGwei(ethGasPriceSuggestion),
          'GWEI - safe gas price for ETH'
        );
        if (!ethGasPriceSuggestion)
          throw new Error(
            'Please, check "ETHINFURA" variable: ' +
              JSON.stringify(ethGasPriceSuggestion)
          );
        const polyGasPriceSuggestion = await getPolygonGasPriceSuggestion();
        console.log(
          convertWeiToGwei(polyGasPriceSuggestion),
          'GWEI - safe gas price for Polygon'
        );
        if (!polyGasPriceSuggestion)
          throw new Error(
            'Please, check "POLYGON_INFURA" variable: ' +
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
        offset: process.env.BLOCKS_OFFSET_ETH,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH,
        fetchLastBlockNumber: this.web3.eth.getBlockNumber,
        offset: process.env.BLOCKS_OFFSET_ETH,
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
      setInterval(fioCtrl.handleUnprocessedWrapActionsOnFioChain, parseInt(process.env.POLLTIME)); //execute wrap FIO tokens and domains action every 60 seconds
      setInterval(fioCtrl.handleUnprocessedUnwrapActionsOnEthChainActions, parseInt(process.env.POLLTIME)); //execute unwrap tokens and domains action every 60 seconds
      setInterval(fioCtrl.handleUnprocessedUnwrapActionsOnPolygon, parseInt(process.env.POLLTIME)); //execute unwrap domains action every 60 seconds
      setInterval(
        fioCtrl.handleUnprocessedBurnNFTActions,
        parseInt(process.env.POLLTIME)
      );

      this.initRoutes(app);

      console.log(logPrefix + `success`);
      console.log(logPrefix + `Mode: ${process.env.MODE}`);
    } catch (err) {
      handleServerError(err, logPrefix);
      throw new Error(
        'In case failing any request, please, check env variables: ETHINFURA, POLYGON_INFURA, POLLTIME'
      );
    }
  }

    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();
