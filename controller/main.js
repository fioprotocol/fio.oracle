import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import fioCtrl from './api/fio.js';

import { FIO_CHAIN_NAME, ACTION_TYPES } from './constants/chain.js';
import { MINUTE_IN_MILLISECONDS } from './constants/general.js';
import { checkAndReplacePendingTransactions } from './jobs/transactions.js';
import fioRoute from './routes/fio.js';
import healthRoute from './routes/health.js';
import { autoRetryMissingActions } from './services/auto-retry-missing-actions.js';
import { handleUnwrap } from './services/unwrap.js';
import {
  getLastIrreversibleBlockOnFioChain,
  getLastFioOracleItemId,
} from './utils/fio-chain.js';
import {
  LOG_DIRECTORY_PATH_NAME,
  getLogFilePath,
  LOG_FILES_KEYS,
} from './utils/log-file-templates.js';
import {
  prepareLogDirectory,
  prepareLogFile,
  handleServerError,
  getLatestNonce,
} from './utils/log-files.js';
import {
  convertWeiToEth,
  convertWeiToGwei,
  getHighestGasPriceSuggestion,
} from './utils/prices.js';
import { Web3Service } from './utils/web3-services.js';

import config from '../config/config.js';

const {
  gas: { USE_GAS_API },
  supportedChains,
  mode,
  jobTimeouts: { DEFAULT_JOB_TIMEOUT, BURN_DOMAINS_JOB_TIMEOUT },
} = config;

const route = express.Router();

class MainCtrl {
  async start(app) {
    const logPrefix = `Startup -->`;

    try {
      // Prepare logs file
      prepareLogDirectory(LOG_DIRECTORY_PATH_NAME);

      // Check oracle addresses balances on chains
      for (const [type, chains] of Object.entries(supportedChains)) {
        for (const supportedChain of chains) {
          const { blocksOffset, chainParams, infura, moralis, publicKey, thirdweb } =
            supportedChain || {};

          const { chainName, chainCode } = chainParams;

          const web3ChainInstance = Web3Service.getWe3Instance({
            chainCode,
            rpcUrl: infura.rpcUrl,
            apiKey: infura.apiKey,
          });

          if (!web3ChainInstance) {
            throw new Error(`Web3 instance not found for chain: ${chainCode}`);
          }

          await web3ChainInstance.eth.getBalance(publicKey, 'latest', (error, result) => {
            if (error) {
              console.log(`${logPrefix} ${error.stack}`);
            } else {
              console.log(
                `${logPrefix} Oracle ${chainName} Address Balance: ${convertWeiToEth(result)} ${chainCode}`,
              );
            }
          });

          const isUsingGasApi = !!parseInt(USE_GAS_API);
          if (isUsingGasApi) {
            const highestGasPriceSuggestion = await getHighestGasPriceSuggestion({
              chainCode,
              infura,
              moralis,
              thirdweb,
            });

            console.log('===============================================');
            console.log(
              `${logPrefix} Highest gas price suggestion for ${chainCode}: ${convertWeiToGwei(highestGasPriceSuggestion)} GWEI`,
            );
            console.log('===============================================');
          }

          // Prepare chain logs files
          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.CHAIN,
              chainCode,
              type,
            }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.WRAP,
              chainCode,
              type,
            }),
          });
          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.WRAP_ERROR,
              chainCode,
              type,
            }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.UNWRAP,
              chainCode,
              type,
            }),
          });
          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.UNWRAP_ERROR,
              chainCode,
              type,
            }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.PENDING_TRANSACTIONS,
              chainCode,
            }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.NONCE,
              chainCode,
            }),
            fetchAction: () => getLatestNonce({ chainCode }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.BLOCK_NUMBER,
              chainCode,
            }),
            fetchAction: () => web3ChainInstance.eth.getBlockNumber(),
            offset: blocksOffset,
          });

          if (type === ACTION_TYPES.NFTS) {
            await prepareLogFile({
              filePath: getLogFilePath({
                key: LOG_FILES_KEYS.BURN_NFTS,
                chainCode,
              }),
            });
            await prepareLogFile({
              filePath: getLogFilePath({
                key: LOG_FILES_KEYS.BURN_NFTS_ERROR,
                chainCode,
              }),
            });
          }

          console.log(`${logPrefix} log files are ready for ${type} ${chainCode}`);
        }
      }

      await prepareLogFile({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }),
      });

      await prepareLogFile({ filePath: getLogFilePath({ key: LOG_FILES_KEYS.FIO }) });

      await prepareLogFile({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.MISSING_ACTIONS }),
      });

      console.log(`${logPrefix} logs folders are ready`);

      await prepareLogFile({
        filePath: getLogFilePath({ key: LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID }),
        fetchAction: getLastFioOracleItemId,
      });
      await prepareLogFile({
        filePath: getLogFilePath({
          key: LOG_FILES_KEYS.BLOCK_NUMBER,
          chainCode: FIO_CHAIN_NAME,
        }),
        fetchAction: getLastIrreversibleBlockOnFioChain,
      });

      console.log(`${logPrefix} blocks folders are ready`);

      // Start Jobs asynchronously immediately
      fioCtrl.handleUnprocessedWrapActionsOnFioChain();
      handleUnwrap();
      fioCtrl.handleUnprocessedBurnNFTActions();

      checkAndReplacePendingTransactions();

      // Start auto-retry missing actions after delay to allow other jobs to initialize
      setTimeout(() => {
        autoRetryMissingActions();
      }, parseInt(DEFAULT_JOB_TIMEOUT));

      // Start Jobs interval
      setInterval(
        fioCtrl.handleUnprocessedWrapActionsOnFioChain,
        parseInt(DEFAULT_JOB_TIMEOUT),
      ); //execute wrap FIO tokens and NFTs action every 60 seconds

      setInterval(handleUnwrap, parseInt(DEFAULT_JOB_TIMEOUT)); //execute unwrap tokens and nfts action every 60 seconds

      setInterval(
        fioCtrl.handleUnprocessedBurnNFTActions,
        parseInt(BURN_DOMAINS_JOB_TIMEOUT),
      );

      setInterval(
        checkAndReplacePendingTransactions,
        parseInt(MINUTE_IN_MILLISECONDS * 3), // check for pending transactions every 3 mins
      );

      setInterval(
        autoRetryMissingActions,
        parseInt(MINUTE_IN_MILLISECONDS * 10), // check for missing actions every 10 mins
      );

      this.initRoutes(app);

      console.log(`${logPrefix} success`);
      console.log(`${logPrefix} Mode: ${mode}`);
    } catch (err) {
      handleServerError(err, logPrefix);
      throw new Error(
        'In case failing any request, please, check config variables values',
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
