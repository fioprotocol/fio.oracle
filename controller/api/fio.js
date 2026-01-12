import fs from 'fs';

import moralis from './moralis.js';
import config from '../../config/config.js';

import {
  ACTIONS,
  ACTION_TYPES,
  AUTOMATIC_BURN_PREFIX,
  FIO_ACCOUNT_NAMES,
  FIO_CHAIN_NAME,
  FIO_CONTRACT_ACTIONS,
  handleActionName,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { SECOND_IN_MILLISECONDS } from '../constants/general.js';
import { handleBurnNFTs } from '../services/burnnfts.js';
import { handleWrap } from '../services/wrap.js';
import {
  createBurnRecordChecker,
  isNonRetryableError,
  verifyAndFilterBurnList,
} from '../utils/burn-utils.js';
import { convertNativeFioIntoFio } from '../utils/chain.js';
import {
  getOracleCacheKey,
  acquireJobLock,
  releaseJobLock,
  isJobLocked,
} from '../utils/cron-jobs.js';
import {
  getOracleItems,
  runUnwrapFioTransaction,
  getFioOracleNftsWithConsensus,
  normalizeNftName,
} from '../utils/fio-chain.js';
import { sleep, convertTimestampIntoMs } from '../utils/general.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import {
  addLogMessage,
  getLastProcessedFioOracleItemId,
  updateFioOracleId,
  handleUpdatePendingItemsQueue,
  handleServerError,
  handleLogFailedUnwrapItem,
} from '../utils/log-files.js';

const {
  fio: { FIO_TRANSACTION_MAX_RETRIES, LOWEST_ORACLE_ID, FIO_SERVER_URL_ACTION },
  supportedChains,
} = config;

class FIOCtrl {
  constructor() {}

  async handleUnprocessedWrapActionsOnFioChain() {
    const logPrefix = 'FIO, Get latest Wrap (tokens and nfts) actions on FIO chain -->';

    if (!acquireJobLock(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, logPrefix)) {
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
          const isWrapOnChainJobExecuting = isJobLocked(cacheKey);

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
    } finally {
      releaseJobLock(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting);
      console.log(`${logPrefix} End`);
    }
  }

  handleUnwrapFromOtherChainsToFioChain = async () => {
    const logPrefix = 'FIO, Process unwrap transactions to FIO chain -->';

    // Use a global cache key for this function since it processes all chains
    if (
      !acquireJobLock(
        ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting,
        logPrefix,
      )
    ) {
      return;
    }
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
              transactionActionData.fio_domain = unwrapData.domain;
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

    releaseJobLock(ORACLE_CACHE_KEYS.isUnwrapFromOtherChainsToFioChainJobExecuting);
    console.log(`${logPrefix} End`);
  };

  async handleUnprocessedBurnNFTActions() {
    const logPrefix = 'FIO, Get latest Burned domain actions on FIO chain -->';

    if (
      !acquireJobLock(
        ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting,
        logPrefix,
      )
    ) {
      return;
    }

    const handleBurnNFTAction = async () => {
      let consensusResult;
      try {
        consensusResult = await getFioOracleNftsWithConsensus({
          serverUrls: FIO_SERVER_URL_ACTION,
        });
      } catch (error) {
        console.error(
          `${logPrefix} Failed to retrieve FIO domain consensus: ${error.message}`,
        );
        throw error;
      }

      const { domains: fioConsensusDomains = [], serverSummaries = [] } =
        consensusResult || {};

      console.log(
        `${logPrefix} FIO consensus domain count: ${fioConsensusDomains.length}`,
      );

      if (Array.isArray(serverSummaries) && serverSummaries.length) {
        console.log(`${logPrefix} FIO Names retrieved per FIO server:`);
        serverSummaries.forEach((summary) => {
          const countValue = summary.count !== undefined ? summary.count : 'N/A';
          const errorText = summary.error ? ` | ${summary.error}` : '';
          const serverLogMessage = `${logPrefix}   ${summary.serverUrl}: ${countValue} FIO Names (${summary.status}${errorText})`;
          console.log(serverLogMessage);
        });
      }

      if (!fioConsensusDomains.length) {
        console.log(`${logPrefix} No FIO Names found via consensus. Skipping burn sync.`);
      } else {
        for (const [type, chains] of Object.entries(supportedChains)) {
          if (type === ACTION_TYPES.NFTS) {
            for (const chain of chains) {
              const { contractAddress, chainParams } = chain;
              const { chainCode, chainId } = chainParams || {};

              console.log(`START GETTING MORALIS NFTS FOR ${chainCode}`);

              const nftsList = await moralis.getAllContractNFTs({
                chainId,
                contractAddress,
              });

              console.log(
                `NFTS LENGTH FOR ${chainCode} = ${nftsList && nftsList.length}`,
              );
              /**
               * BURN LOGIC SUMMARY:
               * ===================
               * An NFT on POL chain should be BURNED when:
               * 1. The domain NO LONGER exists on FIO chain (expired/burned there), OR
               * 2. The domain exists on FIO but is NOT owned by fio.oracle (was unwrapped)
               *
               * An NFT should NOT be burned when:
               * 1. The domain exists on FIO chain AND is owned by fio.oracle (still wrapped)
               * 2. The NFT has no owner on POL (owner_of=null) - means already burned on POL
               * 3. The burn transaction was already executed (exists in logs with receipt)
               *
               * Data sources:
               * - FIO chain: fioConsensusDomains (domains owned by fio.oracle on FIO)
               * - POL chain: nftsList from Moralis (all NFTs in the POL contract)
               */

              // Create a checker function to see if transactions already exist in log files
              const hasExistingBurnRecord = createBurnRecordChecker({
                chainCode,
                logPrefix,
              });

              const burnCandidates = [];
              const candidateStats = {
                added: 0,
                skippedOwnedByOracle: 0,
                skippedAlreadyInFioLog: 0,
                skippedNoOwner: 0,
              };

              console.log(
                `${logPrefix} Starting burn candidate analysis. POL NFTs: ${nftsList.length}, FIO domains: ${fioConsensusDomains.length}`,
              );

              for (const nftItem of nftsList) {
                const { metadata, token_id, normalized_metadata, token_hash, owner_of } =
                  nftItem;

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

                if (!name) continue;

                // Check if domain exists on FIO chain and is owned by fio.oracle
                const existingNftOnFioChain = fioConsensusDomains.find(
                  (nft) => normalizeNftName(nft.name) === normalizeNftName(name),
                );

                if (
                  existingNftOnFioChain &&
                  existingNftOnFioChain.account === FIO_ACCOUNT_NAMES.FIO_ORACLE
                ) {
                  // Domain is still wrapped on FIO - DO NOT burn on POL
                  candidateStats.skippedOwnedByOracle += 1;
                  continue;
                }

                const trxId = `${token_id}${AUTOMATIC_BURN_PREFIX}${name}`;

                // Check if this transaction already exists in log files (FIO log with receipt or burn log)
                if (hasExistingBurnRecord(trxId)) {
                  candidateStats.skippedAlreadyInFioLog += 1;
                  console.log(
                    `${logPrefix} Skipping ${name} (tokenId=${token_id}, obtId=${trxId}) - already executed in log files.`,
                  );
                  continue;
                }

                if (!owner_of) {
                  candidateStats.skippedNoOwner += 1;
                  console.log(
                    `${logPrefix} Skipping NFT with no owner (tokenId=${token_id}, token_hash=${token_hash || 'n/a'}, name=${name || 'n/a'})`,
                  );
                  continue;
                }

                burnCandidates.push({
                  tokenId: token_id,
                  obtId: trxId,
                  nftName: name,
                });

                candidateStats.added += 1;
              }

              console.log(
                `${logPrefix} Burn candidates for ${chainCode} before verification: ${burnCandidates.length}`,
              );

              // Log detailed breakdown of skipped items
              console.log(`${logPrefix} Candidate selection summary for ${chainCode}:`);
              console.log(
                `${logPrefix}   - Added to burn queue: ${candidateStats.added} (domains NOT on FIO or NOT owned by oracle)`,
              );
              if (candidateStats.skippedOwnedByOracle) {
                console.log(
                  `${logPrefix}   - Skipped (owned by fio.oracle on FIO): ${candidateStats.skippedOwnedByOracle} (domain still wrapped, should NOT burn)`,
                );
              }
              if (candidateStats.skippedAlreadyInFioLog) {
                console.log(
                  `${logPrefix}   - Skipped (already in logs): ${candidateStats.skippedAlreadyInFioLog} (burn already executed/attempted)`,
                );
              }
              if (candidateStats.skippedNoOwner) {
                console.log(
                  `${logPrefix}   - Skipped (no owner on POL): ${candidateStats.skippedNoOwner} (likely already burned on POL blockchain)`,
                );
              }

              const nftsListToBurn = await verifyAndFilterBurnList({
                burnCandidates,
                chainCode,
                type,
              });

              console.log(
                `${logPrefix} Burn list for ${chainCode} after verification: ${nftsListToBurn.length}`,
              );

              if (nftsListToBurn.length > 0) {
                console.log(`${logPrefix} Items to burn for ${chainCode}:`);

                const burnQueueFile = getLogFilePath({
                  key: LOG_FILES_KEYS.BURN_NFTS,
                  chainCode,
                });

                nftsListToBurn.forEach((item, index) => {
                  console.log(
                    `  ${index + 1}. NFT Name: ${item.nftName}, Token Id: ${item.tokenId}, Obt Id: ${item.obtId}`,
                  );

                  // Write to burn queue file
                  if (burnQueueFile) {
                    addLogMessage({
                      filePath: burnQueueFile,
                      message: JSON.stringify(item),
                      addTimestamp: false,
                    });
                  }
                });
              } else {
                console.log(`${logPrefix} No items to burn for ${chainCode}.`);
              }

              // Clear large NFT list to free memory before next chain
              if (nftsList && nftsList.length) {
                nftsList.length = 0;
              }
            }
          }
        }

        // Clear FIO consensus domains after all chains processed
        if (fioConsensusDomains && fioConsensusDomains.length) {
          fioConsensusDomains.length = 0;
        }
      }

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
            if (isJobLocked(burnCacheKey)) {
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
    } finally {
      releaseJobLock(ORACLE_CACHE_KEYS.isUnprocessedBurnNFTActionsJobExecuting);
      console.log(`${logPrefix} End`);
    }
  }
}

export default new FIOCtrl();
