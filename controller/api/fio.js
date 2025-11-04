import fs from 'fs';

import moralis from './moralis.js';
import config from '../../config/config.js';

import {
  FIO_ACCOUNT_NAMES,
  FIO_CHAIN_NAME,
  FIO_TABLE_NAMES,
  FIO_CONTRACT_ACTIONS,
} from '../constants/chain.js';
import { ACTIONS, ACTION_TYPES, handleActionName } from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { FIO_NON_RETRYABLE_ERRORS } from '../constants/errors.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { handleBurnNFTs } from '../services/burnnfts.js';
import { handleWrap } from '../services/wrap.js';
import { convertNativeFioIntoFio } from '../utils/chain.js';
import { getOracleCacheKey } from '../utils/cron-jobs.js';
import {
  getLastIrreversibleBlockOnFioChain,
  getOracleItems,
  getFioDeltasV2,
  runUnwrapFioTransaction,
} from '../utils/fio-chain.js';
import { sleep, convertTimestampIntoMs } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  addLogMessage,
  updateBlockNumberFIOForBurnNFT,
  getLastProceededBlockNumberOnFioChainForBurnNFT,
  getLastProcessedFioOracleItemId,
  updateFioOracleId,
  handleUpdatePendingItemsQueue,
  handleServerError,
  handleLogFailedUnwrapItem,
} from '../utils/log-files.js';
import MathOp from '../utils/math.js';

const {
  fio: { FIO_TRANSACTION_MAX_RETRIES, FIO_HISTORY_HYPERION_OFFSET, LOWEST_ORACLE_ID },
  oracleCache,
  supportedChains,
} = config;

/**
 * Check if an error string contains any non-retryable error patterns
 * @param {string} errorString - The error string to check
 * @returns {boolean} - True if error should not be retried
 */
const isNonRetryableError = (errorString) => {
  return FIO_NON_RETRYABLE_ERRORS.some((pattern) => errorString.includes(pattern));
};

class FIOCtrl {
  constructor() {}

  async handleUnprocessedWrapActionsOnFioChain() {
    const logPrefix = 'FIO, Get latest Wrap (tokens and nfts) actions on FIO chain -->';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, true, 0);
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    const handleWrapAction = async () => {
      const lastProcessedFioOracleItemId =
        getLastProcessedFioOracleItemId() || LOWEST_ORACLE_ID;

      console.log(`${logPrefix} start oracle from id = ${lastProcessedFioOracleItemId}`);

      const oracleItems = await getOracleItems({
        logPrefix,
        lowerBound: lastProcessedFioOracleItemId,
      });

      const irreversibleBlockTimeInTimestamp = Date.now() - 181 * SECOND_IN_MILLISECONDS; // irreversibility of block number takes 180 seconds. Take 181 second to be sure it has been submitted.

      const irreversibleOracleItems = oracleItems.filter(({ timestamp }) => {
        const timestampMs = convertTimestampIntoMs(timestamp);

        return timestampMs < irreversibleBlockTimeInTimestamp;
      });

      if (!irreversibleOracleItems || !irreversibleOracleItems.length) {
        console.log(`${logPrefix} No items to wrap`);

        return;
      }

      console.log(`${logPrefix} process items count: ${irreversibleOracleItems.length}`);

      for (const irreversibleOracleItem of irreversibleOracleItems) {
        const { amount, chaincode, id, nftname, pubaddress } = irreversibleOracleItem;
        if (!nftname && !amount) {
          console.log('No data to process');
          return;
        }

        let action, wrapQueueFile;

        const transactionData = {
          chaincode,
          id,
          pubaddress,
        };

        if (nftname) {
          action = `${handleActionName({
            actionName: ACTIONS.WRAP,
            type: ACTION_TYPES.NFTS,
          })} ${chaincode}`;
          wrapQueueFile = getLogFilePath({
            key: LOG_FILES_KEYS.WRAP,
            chainCode: chaincode,
            type: ACTION_TYPES.NFTS,
          });
          transactionData.nftname = nftname;
        } else if (amount) {
          action = `${handleActionName({
            actionName: ACTIONS.WRAP,
            type: ACTION_TYPES.TOKENS,
          })} ${chaincode}`;
          wrapQueueFile = getLogFilePath({
            key: LOG_FILES_KEYS.WRAP,
            chainCode: chaincode,
            type: ACTION_TYPES.TOKENS,
          });
          transactionData.amount = amount;
        }

        const existingFIOLogs = fs
          .readFileSync(getLogFilePath({ key: LOG_FILES_KEYS.FIO }), 'utf-8')
          .toString();

        const isEventDataExists = existingFIOLogs.includes(`"id":${id}`);

        if (!isEventDataExists) {
          addLogMessage({
            filePath: getLogFilePath({ key: LOG_FILES_KEYS.FIO }),
            message: {
              chain: FIO_CHAIN_NAME,
              contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
              action,
              transaction: transactionData,
            },
          });

          // save tx data into wrap queue log files
          addLogMessage({
            filePath: wrapQueueFile,
            message: `${id} ${JSON.stringify(transactionData)}`,
            addTimestamp: false,
          });
        }
      }

      updateFioOracleId((irreversibleOracleItems[0].id + 1).toString());

      for (const [type, chains] of Object.entries(supportedChains)) {
        for (const supportedChain of chains) {
          const { chainCode } = supportedChain.chainParams;
          const cacheKey = getOracleCacheKey({
            actionName: ACTIONS.WRAP,
            type,
            chainCode,
          });
          const isWrapOnChainJobExecuting = oracleCache.get(cacheKey);

          if (!isWrapOnChainJobExecuting) {
            console.log(
              `${logPrefix} Starting handleWrap for ${chainCode} ${type} (cache was ${isWrapOnChainJobExecuting === undefined ? 'not set' : 'false'})`,
            );
            handleWrap({ type, ...supportedChain });
          } else {
            console.log(
              `${logPrefix} Skipping handleWrap for ${chainCode} ${type} - job already running`,
            );
          }
        }
      }
    };

    try {
      await handleWrapAction();
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedWrapActionsOnFioChain');
    }
    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, false, 0);
    console.log(`${logPrefix} End`);
  }

  handleUnwrapFromOtherChainsToFioChain = async () => {
    const logPrefix = 'FIO, Process unwrap transactions to FIO chain -->';

    // Use a global cache key for this function since it processes all chains
    if (
      oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting)
    ) {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    oracleCache.set(
      ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting,
      true,
      0,
    );
    console.log(`${logPrefix} Start`);

    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        const { chainCode } = chain.chainParams;

        const transactionToProceed = fs
          .readFileSync(getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP, chainCode, type }))
          .toString()
          .split('\r\n')[0];
        if (transactionToProceed === '') {
          // No transactions for this chain, continue to next chain
          continue;
        }

        const txIdOnEthChain = transactionToProceed.split(' ')[0];
        const unwrapData = JSON.parse(transactionToProceed.split(' ')[1]);

        const fioAddress = unwrapData.fioaddress;
        let isTransactionProceededSuccessfully = false;

        const txLogPrefix = `FIO, unwrapFrom${chainCode}ToFioChainJob, ${chainCode} tx_id: "${txIdOnEthChain}", ${unwrapData.amount ? `amount: ${convertNativeFioIntoFio(unwrapData.amount)} wFIO` : `nfts: "${unwrapData.domain}"`}, fioAddress :  "${fioAddress}": -->`;
        console.log(`${txLogPrefix} Start`);

        let retries = 0;
        let shouldStopRetrying = false;

        while (
          retries < FIO_TRANSACTION_MAX_RETRIES &&
          !isTransactionProceededSuccessfully &&
          !shouldStopRetrying
        ) {
          try {
            const actionName = FIO_CONTRACT_ACTIONS[ACTIONS.UNWRAP][type];

            const transactionActionData = {
              fio_address: fioAddress,
              obt_id: txIdOnEthChain,
            };

            if (unwrapData.amount) {
              transactionActionData.amount = parseInt(unwrapData.amount);
            } else if (unwrapData.domain) {
              transactionActionData.domain = unwrapData.domain;
            }

            const transactionResult = await runUnwrapFioTransaction({
              actionName,
              transactionActionData,
            });

            if (!(transactionResult.type || transactionResult.error)) {
              isTransactionProceededSuccessfully = true;
              console.log(`${txLogPrefix} Completed:`);
            } else {
              // Check for non-retryable errors
              const errorString = JSON.stringify(transactionResult);
              if (isNonRetryableError(errorString)) {
                console.log(
                  `${txLogPrefix} Non-retryable error detected (will not retry):`,
                );
                console.log(errorString);
                shouldStopRetrying = true;
              } else {
                retries++;
                console.log(`${txLogPrefix} Error:`);
                console.log(`${txLogPrefix} Retry increment to ${retries}`);
              }
            }

            console.log(JSON.stringify(transactionResult, null, 4));

            addLogMessage({
              filePath: getLogFilePath({ key: LOG_FILES_KEYS.FIO }),
              message: {
                chain: FIO_CHAIN_NAME,
                contract: FIO_ACCOUNT_NAMES.FIO_ORACLE,
                action: actionName,
                transaction: transactionResult,
              },
            });
          } catch (error) {
            // Check for non-retryable errors in caught exceptions
            const errorString = error.message || error.toString();
            if (isNonRetryableError(errorString)) {
              console.log(
                `${txLogPrefix} Non-retryable error detected (will not retry):`,
              );
              console.log(errorString);
              shouldStopRetrying = true;
              handleServerError(error, 'FIO, handleUnwrapFromOtherChainsToFioChain');
            } else {
              retries++;
              await sleep(SECOND_IN_MILLISECONDS);
              handleServerError(error, 'FIO, handleUnwrapFromOtherChainsToFioChain');
            }
          }
        }

        if (!isTransactionProceededSuccessfully) {
          if (shouldStopRetrying) {
            console.log(
              `${txLogPrefix} Transaction failed with non-retryable error and will be moved to error queue`,
            );
          } else {
            console.log(
              `${txLogPrefix} Transaction failed after ${retries} retries and will be moved to error queue`,
            );
          }

          handleLogFailedUnwrapItem({
            logPrefix: txLogPrefix,
            errorLogFilePath: getLogFilePath({
              key: LOG_FILES_KEYS.UNWRAP_ERROR,
              chainCode,
              type,
            }),
            txId: txIdOnEthChain,
            unwrapData,
          });
        }

        handleUpdatePendingItemsQueue({
          action: this.handleUnwrapFromOtherChainsToFioChain,
          logPrefix: txLogPrefix,
          logFilePath: getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP, chainCode, type }),
          jobIsRunningCacheKey:
            ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting,
        });
      }
    }

    oracleCache.set(
      ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting,
      false,
      0,
    );
    console.log(`${logPrefix} End`);
  };

  async handleUnprocessedBurnNFTActions() {
    const logPrefix = 'FIO, Get latest Burned domain actions on FIO chain -->';

    if (!oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting)) {
      oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, true, 0);
    } else {
      console.log(`${logPrefix} Job is already running`);
      return;
    }

    const handleBurnNFTAction = async () => {
      const lastProcessedFioBlockNumber =
        getLastProceededBlockNumberOnFioChainForBurnNFT() || 0;
      const lastIrreversibleBlock = (await getLastIrreversibleBlockOnFioChain()) || 0;

      console.log(`${logPrefix} start Position = ${lastProcessedFioBlockNumber}`);

      const unprocessedBurnedDomainsList = [];

      const after = lastProcessedFioBlockNumber;
      const before = lastIrreversibleBlock;

      const paramsToPass = {
        code: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
        scope: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
        after,
        before,
        present: 0,
        table: FIO_TABLE_NAMES.FIO_DOMAINS,
        limit: FIO_HISTORY_HYPERION_OFFSET,
        payer: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
      };

      const getFioBurnedDomainsLogsAll = async (params) => {
        const burnedDomainsLogs = await getFioDeltasV2(params);

        if (
          burnedDomainsLogs &&
          burnedDomainsLogs.deltas &&
          burnedDomainsLogs.deltas.length
        ) {
          const deltasLength = burnedDomainsLogs.deltas.length;

          unprocessedBurnedDomainsList.push(
            ...burnedDomainsLogs.deltas
              .filter(
                (deltaItem) => deltaItem.data.account === FIO_ACCOUNT_NAMES.FIO_ORACLE,
              )
              .map((deltaItem) => deltaItem.data.name),
          );

          if (deltasLength) {
            const lastDeltasItem = burnedDomainsLogs.deltas[deltasLength - 1];
            if (lastDeltasItem && lastDeltasItem.block_num) {
              params.before = new MathOp(deltasLength).eq(burnedDomainsLogs.total.value)
                ? lastDeltasItem.block_num - 1
                : lastDeltasItem.block_num;
            }
            // add 1 sec to decrease 429 Too Many requests
            await sleep(SECOND_IN_MILLISECONDS);

            await getFioBurnedDomainsLogsAll(params);
          }
        }
      };

      await getFioBurnedDomainsLogsAll(paramsToPass);

      if (unprocessedBurnedDomainsList.length) {
        console.log(
          `${logPrefix} Burned Domains List From Fio Length: ${unprocessedBurnedDomainsList.length}`,
        );

        for (const [type, chains] of Object.entries(supportedChains)) {
          if (type === ACTION_TYPES.NFTS) {
            for (const chain of chains) {
              const { contractAddress, chainParams } = chain;
              const { chainCode, chainId } = chainParams || {};

              const nftsListToBurn = [];

              console.log(`START GETTING MORALIS NFTS FOR ${chainCode}`);

              const nftsList = await moralis.getAllContractNFTs({
                chainId,
                contractAddress,
              });

              console.log(
                `NFTS LENGTH FOR ${chainCode} = ${nftsList && nftsList.length}`,
              );

              for (const nftItem of nftsList) {
                const { metadata, token_id, normalized_metadata } = nftItem;

                let metadataName = null;

                if (normalized_metadata && normalized_metadata.name) {
                  metadataName = normalized_metadata.name;
                } else if (metadata) {
                  try {
                    const parsedMetadata = JSON.parse(metadata);
                    if (parsedMetadata && parsedMetadata.name) {
                      metadataName = parsedMetadata.name;
                    }
                  } catch (error) {
                    console.error(`${logPrefix} Failed to parse metadata: ${error}`);
                  }
                }

                const name = metadataName && metadataName.split(': ')[1];

                if (name) {
                  const existingDomainInBurnList = unprocessedBurnedDomainsList.find(
                    (burnedDomain) => name === burnedDomain,
                  );

                  if (existingDomainInBurnList) {
                    const trxId = `${token_id}AutomaticDomainBurn${name}`;

                    nftsListToBurn.push({
                      tokenId: token_id,
                      obtId: trxId,
                      nftName: name,
                    });

                    const existingFIOLogs = fs
                      .readFileSync(getLogFilePath({ key: LOG_FILES_KEYS.FIO }), 'utf-8')
                      .toString();

                    const isActionDataExists = existingFIOLogs.includes(trxId);

                    if (!isActionDataExists) {
                      addLogMessage({
                        filePath: getLogFilePath({ key: LOG_FILES_KEYS.FIO }),
                        message: {
                          chain: FIO_CHAIN_NAME,
                          contract: FIO_ACCOUNT_NAMES.FIO_ADDRESS,
                          action: `burnDomain ${chainCode}`,
                          transaction: { trxId, nftName: name },
                        },
                      });
                    }
                  }
                }

                console.log(
                  `Nfts List To Burn FOR ${chainCode}: length = ${nftsListToBurn.length}`,
                );
              }

              for (const nftsListToBurnItem of nftsListToBurn) {
                const existingNFTTransactionsQueue = fs
                  .readFileSync(
                    getLogFilePath({
                      key: LOG_FILES_KEYS.BURN_NFTS,
                      chainCode,
                      type,
                    }),
                    'utf-8',
                  )
                  .toString();

                const isActionDataExists = existingNFTTransactionsQueue.includes(
                  nftsListToBurnItem.obtId,
                );

                if (!isActionDataExists) {
                  addLogMessage({
                    filePath: getLogFilePath({
                      key: LOG_FILES_KEYS.BURN_NFT_TRANSACTIONS_QUEUE,
                      chainCode,
                      type,
                    }),
                    message: nftsListToBurnItem,
                    addTimestamp: false,
                  });
                }
              }

              console.log(
                `${logPrefix} Update FIO Block Number for burn NFTS for ${chainCode}: ${lastIrreversibleBlock}`,
              );
            }
          }
        }
      } else {
        console.log(`${logPrefix} No nfts to burn.`);
      }

      updateBlockNumberFIOForBurnNFT(lastIrreversibleBlock.toString());

      // Check if any burn NFT job is currently executing for any chain
      let isBurnNFTJobExecuting = false;
      for (const [type, chains] of Object.entries(supportedChains)) {
        if (type === ACTION_TYPES.NFTS) {
          for (const chain of chains) {
            const { chainCode } = chain.chainParams;
            const burnCacheKey = getOracleCacheKey({
              actionName: ACTIONS.BURN,
              chainCode,
              type,
            });
            if (oracleCache.get(burnCacheKey)) {
              isBurnNFTJobExecuting = true;
              break;
            }
          }
          if (isBurnNFTJobExecuting) break;
        }
      }

      console.log(`${logPrefix} isBurnNFTJobExecuting: ${!!isBurnNFTJobExecuting}`);

      if (!isBurnNFTJobExecuting) {
        handleBurnNFTs();
      }
    };

    try {
      await handleBurnNFTAction();
    } catch (err) {
      handleServerError(err, 'FIO, handleUnprocessedBurnNFTActions');
    }

    oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting, false, 0);
    console.log(`${logPrefix} End`);
  }
}

export default new FIOCtrl();
