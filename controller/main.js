import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import fioCtrl from './api/fio.js';

import {
  ETH_CHAIN_NAME_CONSTANT,
  ETH_TOKEN_CODE,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
} from './constants/chain.js';
import { MINUTE_IN_MILLISECONDS } from './constants/general.js';
import { LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME } from './constants/log-files.js';

import { checkAndReplacePendingTransactions } from './jobs/transactions.js';
import fioRoute from './routes/fio.js';
import {
  getLastIrreversibleBlockOnFioChain,
  getLastFioOracleItemId,
} from './utils/fio-chain.js';
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
  getHighestEthGasPriceSuggestion,
  getHighestPolygonGasPriceSuggestion,
} from './utils/prices.js';
import { Web3Service } from './utils/web3-services.js';

import config from '../config/config.js';
import healthRoute from './routes/health.js';

const {
  gas: { USE_GAS_API },
  eth: { ETH_ORACLE_PUBLIC, BLOCKS_OFFSET_ETH },
  mode,
  polygon: { POLYGON_ORACLE_PUBLIC },
  jobTimeouts: { DEfAULT_JOB_TIMEOUT, BURN_DOMAINS_JOB_TIMEOUT },
} = config;

const route = express.Router();

class MainCtrl {
  async start(app) {
    const logPrefix = `Startup -->`;

    try {
      // Check oracle addresses balances on ETH and Polygon chains
      await Web3Service.getEthWeb3().eth.getBalance(
        ETH_ORACLE_PUBLIC,
        'latest',
        (error, result) => {
          if (error) {
            console.log(`${logPrefix} ${error.stack}`);
          } else {
            console.log(
              `${logPrefix} Oracle ${ETH_CHAIN_NAME_CONSTANT} Address Balance: ${convertWeiToEth(result)} ${ETH_TOKEN_CODE}`,
            );
          }
        },
      );
      await Web3Service.getPolygonWeb3().eth.getBalance(
        POLYGON_ORACLE_PUBLIC,
        'latest',
        (error, result) => {
          if (error) {
            console.log(`${logPrefix} ${error.stack}`);
          } else {
            console.log(
              `${logPrefix} Oracle ${POLYGON_CHAIN_NAME} Address Balance: ${convertWeiToEth(result)} ${POLYGON_TOKEN_CODE}`,
            );
          }
        },
      );

      // Check is INFURA_ETH and INFURA_POLYGON variables are valid
      const isUsingGasApi = !!parseInt(USE_GAS_API);
      if (isUsingGasApi) {
        const ethGasPriceSuggestion = await getHighestEthGasPriceSuggestion();

        console.log(
          convertWeiToGwei(ethGasPriceSuggestion),
          'GWEI - safe gas price for ETH',
        );
        if (!ethGasPriceSuggestion)
          throw new Error(
            'Please, check "INFURA_ETH" variable: ' +
              JSON.stringify(ethGasPriceSuggestion),
          );
        const polyGasPriceSuggestion = await getHighestPolygonGasPriceSuggestion();
        console.log(
          convertWeiToGwei(polyGasPriceSuggestion),
          'GWEI - safe gas price for Polygon',
        );
        if (!polyGasPriceSuggestion)
          throw new Error(
            'Please, check "INFURA_POLYGON" variable: ' +
              JSON.stringify(polyGasPriceSuggestion),
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
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.POLYGON });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions,
      });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.ethPendingTransactions });
      await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.polygonPendingTransactions });

      console.log(`${logPrefix} logs folders are ready`);

      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.fioOracleItemId,
        fetchAction: getLastFioOracleItemId,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT,
        fetchAction: getLastIrreversibleBlockOnFioChain,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH,
        fetchAction: () => Web3Service.getEthWeb3().eth.getBlockNumber(),
        offset: BLOCKS_OFFSET_ETH,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH,
        fetchAction: () => Web3Service.getEthWeb3().eth.getBlockNumber(),
        offset: BLOCKS_OFFSET_ETH,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon,
        fetchAction: () => Web3Service.getPolygonWeb3().eth.getBlockNumber(),
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.ethNonce,
        fetchAction: getLatestEthNonce,
      });
      await prepareLogFile({
        filePath: LOG_FILES_PATH_NAMES.polygonNonce,
        fetchAction: getLatestPolygonNonce,
      });
      console.log(`${logPrefix} blocks folders are ready`);

      // Start Jobs asynchronously immediately
      fioCtrl.handleUnprocessedWrapActionsOnFioChain();
      fioCtrl.handleUnprocessedUnwrapActionsOnEthChainActions();
      fioCtrl.handleUnprocessedUnwrapActionsOnPolygon();
      fioCtrl.handleUnprocessedBurnNFTActions();

      checkAndReplacePendingTransactions();
      // Start Jobs interval
      setInterval(
        fioCtrl.handleUnprocessedWrapActionsOnFioChain,
        parseInt(DEfAULT_JOB_TIMEOUT),
      ); //execute wrap FIO tokens and domains action every 60 seconds
      setInterval(
        fioCtrl.handleUnprocessedUnwrapActionsOnEthChainActions,
        parseInt(DEfAULT_JOB_TIMEOUT),
      ); //execute unwrap tokens and domains action every 60 seconds
      setInterval(
        fioCtrl.handleUnprocessedUnwrapActionsOnPolygon,
        parseInt(DEfAULT_JOB_TIMEOUT),
      ); //execute unwrap domains action every 60 seconds
      setInterval(
        fioCtrl.handleUnprocessedBurnNFTActions,
        parseInt(BURN_DOMAINS_JOB_TIMEOUT),
      );
      setInterval(
        checkAndReplacePendingTransactions,
        parseInt(MINUTE_IN_MILLISECONDS * 3), // check for pending transactions every 3 mins
      );

      this.initRoutes(app);

      console.log(`${logPrefix} success`);
      console.log(`${logPrefix} Mode: ${mode}`);
    } catch (err) {
      handleServerError(err, logPrefix);
      throw new Error(
        'In case failing any request, please, check env variables values: INFURA_ETH, INFURA_POLYGON',
      );
    }
  }

  initRoutes(app) {
    route.use(cors({ origin: '*' }));
    app.use(fioRoute);
    app.use('/api/v1', healthRoute);
  }
}

export default new MainCtrl();
