import fs from 'fs';

import config from '../../config/config.js';

import { ACTIONS, ACTION_TYPES, handleActionName } from '../constants/chain.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { TRANSACTION_DELAY } from '../constants/transactions.js';
import { isOracleAddressValid } from '../utils/chain.js';
import { getOracleCacheKey } from '../utils/cron-jobs.js';
import { sleep } from '../utils/general.js';
import { LOG_FILES_KEYS, getLogFilePath } from '../utils/log-file-templates.js';
import {
  handleServerError,
  handleLogFailedBurnNFTItem,
  handleChainError,
  handleUpdatePendingItemsQueue,
  addLogMessage,
} from '../utils/log-files.js';
import { blockChainTransaction } from '../utils/transactions.js';
import { Web3Service } from '../utils/web3-services.js';

const { oracleCache, supportedChains } = config;

export const handleBurnNFTs = async () => {
  for (const [type, chains] of Object.entries(supportedChains)) {
    if (type === ACTION_TYPES.NFTS) {
      for (const chain of chains) {
        const {
          contractAddress,
          chainParams,
          contractTypeName,
          moralis: moralisConfig,
          infura,
        } = chain;

        const { chainCode } = chainParams || {};

        const cacheKey = getOracleCacheKey({
          actionName: ACTIONS.BURN,
          chainCode,
          type,
        });

        const isBurnNFTJobExecuting = oracleCache.get(cacheKey);
        if (!isBurnNFTJobExecuting) {
          oracleCache.set(cacheKey, true, 0);
        }

        const transactionToProceed = fs
          .readFileSync(
            getLogFilePath({
              key: LOG_FILES_KEYS.BURN_NFTS,
              chainCode,
              type,
            }),
          )
          .toString()
          .split('\r\n')[0];

        if (transactionToProceed === '') {
          oracleCache.set(cacheKey, false, 0);
          return;
        }

        const burnNFTData = JSON.parse(transactionToProceed);

        const { tokenId, obtId, nftName } = burnNFTData || {};

        const actionNameType = handleActionName({ actionName: ACTIONS.BURN, type });

        const logPrefix = `${chainCode}, ${actionNameType}, FIO obtId: ${obtId}, nftName: ${nftName}, tokenId: ${tokenId}: -->`;
        console.log(`${logPrefix} Executing ${actionNameType}.`);

        try {
          const contract = Web3Service.getWeb3Contract({
            apiKey: infura.apiKey,
            type,
            chainCode,
            contractAddress,
            rpcUrl: infura.rpcUrl,
          });

          const isOracleAddressValidResult = await isOracleAddressValid({
            contract,
            publicKey: moralisConfig.publicKey,
          });

          if (!isOracleAddressValidResult) {
            console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
            oracleCache.set(cacheKey, false, 0);
          } else {
            let isTransactionProceededSuccessfully = false;

            try {
              // Need to set timeout to handle a big amount of burn calls to blockchain
              await sleep(TRANSACTION_DELAY);

              const onSussessTransaction = (receipt) => {
                addLogMessage({
                  filePath: getLogFilePath({
                    key: LOG_FILES_KEYS.CHAIN,
                    chainCode,
                    type,
                  }),
                  message: `${chainCode} ${actionNameType} ${contractTypeName} ${receipt}`,
                });

                isTransactionProceededSuccessfully = true;
              };

              await blockChainTransaction({
                action: actionNameType,
                type,
                chainCode,
                contract,
                contractActionParams: {
                  tokenId,
                  obtId,
                },
                handleSuccessedResult: onSussessTransaction,
                logPrefix,
                shouldThrowError: true,
              });
            } catch (error) {
              handleChainError({
                logMessage: `BURN ERROR ${chainCode} ${contractTypeName} ${actionNameType} ${error}`,
                consoleMessage: `${logPrefix} ${error.stack}`,
              });
            }

            if (!isTransactionProceededSuccessfully) {
              handleLogFailedBurnNFTItem({
                logPrefix,
                errorLogFilePath: getLogFilePath({
                  key: LOG_FILES_KEYS.BURN_NFTS_ERROR,
                  chainCode,
                  type,
                }),
                burnData: JSON.stringify(burnNFTData),
              });
            }

            handleUpdatePendingItemsQueue({
              action: () => handleBurnNFTs(),
              logPrefix,
              logFilePath: getLogFilePath({
                key: LOG_FILES_KEYS.BURN_NFTS,
                chainCode,
                type,
              }),
              jobIsRunningCacheKey: cacheKey,
            });
          }
        } catch (error) {
          console.error(error);
          oracleCache.set(cacheKey, false, 0);

          handleServerError(error, `${chainCode}, ${actionNameType}`);
        }
      }
    }
  }
};
