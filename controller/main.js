import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import fioCtrl from './api/fio.js';

import { FIO_CHAIN_NAME, ACTION_TYPES } from './constants/chain.js';
import { MINUTE_IN_MILLISECONDS } from './constants/general.js';
import { checkAndReplacePendingTransactions } from './jobs/transactions.js';
import healthRoute from './routes/health.js';
import { autoRetryMissingActions } from './services/auto-retry-missing-actions.js';
import { initializeEventCache, runEventCacheService } from './services/event-cache.js';
import { handleUnwrap } from './services/unwrap.js';
import {
  getLastIrreversibleBlockOnFioChain,
  getLastFioOracleItemId,
} from './utils/fio-chain.js';
import { logAppVersionToSystemLog } from './utils/general.js';
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
  cleanupInvalidLogFiles,
} from './utils/log-files.js';
import { initializeLogScheduler } from './utils/log-scheduler.js';
import logger from './utils/logger.js';
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
  jobTimeouts: {
    AUTO_RETRY_MISSING_ACTIONS_TIMEOUT,
    BURN_DOMAINS_JOB_TIMEOUT,
    DEFAULT_JOB_TIMEOUT,
  },
  logging: { SYNC_INTERVAL_HOURS, ENABLE_S3_SYNC },
} = config;

const route = express.Router();

class MainCtrl {
  async start(app) {
    const logPrefix = `Startup -->`;

    try {
      // Show startup information
      logger.showStartupInfo();

      // Prepare logs directory first (must exist before writing to log files)
      prepareLogDirectory(LOG_DIRECTORY_PATH_NAME);

      // Log app version after directory is created
      await logAppVersionToSystemLog({
        context: `Starting in ${mode} mode`,
        logPrefix,
      });

      // Clean up invalid log files (those not matching current configuration)
      cleanupInvalidLogFiles(true);

      // Check oracle addresses balances on chains
      for (const [type, chains] of Object.entries(supportedChains)) {
        for (const supportedChain of chains) {
          const { blocksOffset, chainParams, infura, moralis, publicKey, thirdweb } =
            supportedChain || {};

          const { chainName, chainCode } = chainParams;

          const web3ChainInstance = Web3Service.getWe3Instance({ chainCode });

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

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.UNWRAP_PROCESSED_BLOCK_NUMBER,
              chainCode,
            }),
          });

          await prepareLogFile({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.EVENT_CACHE_EVENTS,
              chainCode,
              type,
            }),
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

      // ========================================
      // Initialize Event Cache Service
      // This MUST run BEFORE unwrap and auto-retry jobs
      // ========================================
      console.log('='.repeat(60));
      console.log('📦 Initializing Event Cache Service...');
      console.log('='.repeat(60));

      // Load existing cache from disk (if available)
      initializeEventCache();
      console.log('✅ Event cache initialized from disk');

      // Run first cache update immediately
      console.log('🔄 Running initial event cache update...');
      await runEventCacheService();

      // Wait 5 seconds for cache to fully populate
      console.log('⏳ Waiting 5s for cache to settle before starting jobs...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      console.log('='.repeat(60));
      console.log('✅ Event Cache Ready - Starting Jobs');
      console.log('='.repeat(60));
      // ========================================

      // Start Jobs asynchronously immediately
      fioCtrl.handleUnprocessedWrapActionsOnFioChain();
      handleUnwrap();
      fioCtrl.handleUnprocessedBurnNFTActions();

      checkAndReplacePendingTransactions();

      // Start auto-retry missing actions after delay to allow other jobs to initialize
      setTimeout(() => {
        autoRetryMissingActions();
      }, parseInt(DEFAULT_JOB_TIMEOUT));

      // ========================================
      // Event Cache Service Interval (MUST BE FIRST)
      // Runs every 60 seconds to keep cache updated
      // ========================================
      setInterval(runEventCacheService, parseInt(DEFAULT_JOB_TIMEOUT)); // Event cache updates every 60 seconds
      // ========================================

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
        parseInt(AUTO_RETRY_MISSING_ACTIONS_TIMEOUT), // check for missing actions every AUTO_RETRY_MISSING_ACTIONS_TIMEOUT mins
      );

      this.initRoutes(app);

      // Initialize log scheduler for S3 sync (syncs every hour, never clears files)
      // Only if S3 sync is enabled
      if (ENABLE_S3_SYNC) {
        initializeLogScheduler(SYNC_INTERVAL_HOURS);
      } else {
        console.log('⚠️  S3 sync is DISABLED (ENABLE_S3_SYNC=false)');
        console.log('   Logs will only be stored locally');
      }

      logger.info(`${logPrefix} success`);
      logger.info(`${logPrefix} Mode: ${mode}`);
      console.log(`${logPrefix} success`);
      console.log(`${logPrefix} Mode: ${mode}`);

      // Final status message
      console.log('='.repeat(60));
      console.log('✅ ALL SERVICES STARTED SUCCESSFULLY');
      console.log(`📊 Event Cache: Running every ${DEFAULT_JOB_TIMEOUT}ms`);
      console.log('💡 Unwrap & Auto-Retry: Always using event cache');
      console.log('='.repeat(60));
    } catch (err) {
      handleServerError(err, logPrefix);
      throw new Error(
        'In case failing any request, please, check config variables values',
      );
    }
  }

  initRoutes(app) {
    route.use(cors({ origin: '*' }));
    app.use('/api/v1', healthRoute);
  }
}

export default new MainCtrl();
