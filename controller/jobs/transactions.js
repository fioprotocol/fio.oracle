import config from '../../config/config.js';
import {
  TRANSACTION_NOT_FOUND,
  MAX_TRANSACTION_AGE,
  MAX_REPLACEMENT_ATTEMPTS,
} from '../constants/transactions.js';
import { getLogFilePath, LOG_FILES_KEYS } from '../utils/log-file-templates.js';
import { readLogFile, removePendingTransaction } from '../utils/log-files.js';
import { handleChainError } from '../utils/log-files.js';
import {
  blockChainTransaction,
  getDefaultTransactionParams,
} from '../utils/transactions.js';

const { supportedChains } = config || {};

export const checkAndReplacePendingTransactions = async () => {
  const handlePendingTransaction = async ({ chainCode, type }) => {
    const logPrefix = `${chainCode} Pending transactions handle: --> `;

    try {
      const defaultTransactionParams = await getDefaultTransactionParams({
        chainCode,
        type,
      });
      const { publicKey, web3Instance } = defaultTransactionParams || {};

      const pendingTransactionFilePath = getLogFilePath({
        key: LOG_FILES_KEYS.PENDING_TRANSACTIONS,
        chainCode,
      });

      const currentTime = Date.now();

      const latestNonce = Number(
        await web3Instance.eth.getTransactionCount(publicKey, 'latest'),
      );

      let pendingTransactions = [];
      try {
        const fileContent = readLogFile(pendingTransactionFilePath);

        if (!fileContent || !fileContent.trim()) {
          console.log(`${logPrefix} No pending transactions.`);
          return; // No pending transactions
        }

        pendingTransactions = fileContent
          .split('\n')
          .filter((line) => line.trim()) // Remove empty lines
          .map((line) => {
            try {
              // Split only on the first space to handle actions with spaces like "wrap nfts"
              const spaceIndex = line.indexOf(' ');
              if (spaceIndex === -1) {
                console.error(`${logPrefix} Invalid transaction line format:`, line);
                return null;
              }
              const hash = line.substring(0, spaceIndex);
              const dataStr = line.substring(spaceIndex + 1);
              return {
                hash,
                ...JSON.parse(dataStr),
              };
            } catch (e) {
              console.error(`${logPrefix} Error parsing transaction data:`, e);
              return null;
            }
          })
          .filter(Boolean);
      } catch (error) {
        console.error(`${logPrefix} Error reading pending transactions file:`, error);
        return;
      }

      // Sort by nonce to handle them in order
      pendingTransactions.sort((a, b) => a.txNonce - b.txNonce);

      // Count replacement attempts per nonce
      const replacementCountByNonce = {};
      pendingTransactions.forEach((tx) => {
        if (tx.isReplaceTx) {
          replacementCountByNonce[tx.txNonce] =
            (replacementCountByNonce[tx.txNonce] || 0) + 1;
        }
      });

      // Remove transactions with nonce less than latest confirmed nonce or transaction has been already replaced
      pendingTransactions = pendingTransactions.filter((tx) => {
        const isReplaced = pendingTransactions.some(
          (pendingTx) => pendingTx.originalTxHash === tx.hash,
        );

        // Check if this nonce has exceeded max replacement attempts
        const replacementCount = replacementCountByNonce[tx.txNonce] || 0;
        if (replacementCount >= MAX_REPLACEMENT_ATTEMPTS) {
          console.log(
            `${logPrefix} Max replacement attempts (${MAX_REPLACEMENT_ATTEMPTS}) reached for nonce ${tx.txNonce}. Removing transaction: ${tx.hash}`,
          );
          removePendingTransaction({
            hash: tx.hash,
            logFilePath: pendingTransactionFilePath,
            logPrefix,
          });
          return false;
        }

        if (tx.txNonce < latestNonce || isReplaced) {
          console.log(
            `${logPrefix} Removing old transaction with nonce ${tx.txNonce} (latest nonce: ${latestNonce}): ${tx.hash}`,
          );
          removePendingTransaction({
            hash: tx.hash,
            logFilePath: pendingTransactionFilePath,
            logPrefix,
          });
          return false;
        }
        return true;
      });

      const getTransactionFromChain = async ({ txHash, isReplaceTx }) => {
        try {
          const tx = await web3Instance.eth.getTransaction(txHash);
          console.log(`${logPrefix} Found transaction ${txHash}`);
          return tx;
        } catch (error) {
          if (!error.message.toLowerCase().includes(TRANSACTION_NOT_FOUND)) {
            throw error;
          }
          console.log(
            `${logPrefix} (replaced: ${isReplaceTx}) ${error.message}: ${txHash}`,
          );
          return null;
        }
      };

      // Group transactions by nonce to only process the first one per nonce
      const processedNonces = new Set();

      for (const {
        action,
        chainCode,
        contractActionParams,
        hash,
        isReplaceTx,
        timestamp,
        txNonce: pendingTxNonce,
        originalTxHash,
      } of pendingTransactions) {
        let tx;

        // Try to get original transaction first if it exists
        if (originalTxHash) {
          tx = await getTransactionFromChain({ txHash: originalTxHash, isReplaceTx });
        }

        // If original not found or doesn't exist, try the replacement
        if (!tx) {
          tx = await getTransactionFromChain({ txHash: hash, isReplaceTx });
        }

        // Transaction is mined
        if (tx && tx.blockNumber) {
          removePendingTransaction({
            hash,
            logFilePath: pendingTransactionFilePath,
            logPrefix,
          });
          continue;
        }

        // Check if we've already processed a transaction for this nonce in this run
        if (processedNonces.has(pendingTxNonce)) {
          continue;
        }

        if (!tx || currentTime - timestamp > MAX_TRANSACTION_AGE) {
          // Count how many replacement attempts exist for this nonce
          // Use pre-computed count to avoid creating temporary array in loop
          const replacementCount = replacementCountByNonce[pendingTxNonce] || 0;

          // Stop if we've reached the limit
          if (replacementCount >= MAX_REPLACEMENT_ATTEMPTS) {
            console.log(
              `${logPrefix} Reached max replacement attempts (${replacementCount}/${MAX_REPLACEMENT_ATTEMPTS}) for nonce ${pendingTxNonce}. Rejecting transaction to prevent account blocking.`,
            );
            // Remove all pending transactions for this nonce
            // Use direct iteration to avoid creating temporary array
            for (const t of pendingTransactions) {
              if (t.txNonce === pendingTxNonce) {
                removePendingTransaction({
                  hash: t.hash,
                  logFilePath: pendingTransactionFilePath,
                  logPrefix,
                });
              }
            }
            continue;
          }

          // If no tx - transaction not in mempool
          if (tx) {
            console.log(
              `${logPrefix} Found stuck transaction: ${hash} (attempt ${replacementCount + 1}/${MAX_REPLACEMENT_ATTEMPTS})`,
            );
          } else {
            console.log(
              `${logPrefix} Transaction ${hash} not in mempool and timed out, attempting replacement (${replacementCount + 1}/${MAX_REPLACEMENT_ATTEMPTS})`,
            );
          }

          // Mark this nonce as processed to prevent multiple replacements in one run
          processedNonces.add(pendingTxNonce);

          // Only replace the earliest stuck transaction
          await blockChainTransaction({
            action,
            chainCode,
            contractActionParams,
            isReplaceTx: true,
            logPrefix,
            originalTxHash: hash,
            pendingTxNonce: pendingTxNonce,
            replacementAttempt: replacementCount,
            type,
          });
        }
      }
    } catch (error) {
      handleChainError({
        logMessage: `${logPrefix} ${chainCode} checking pending transactions failed: ${error}`,
        consoleMessage: error,
      });
    }
  };

  try {
    for (const [type, chains] of Object.entries(supportedChains)) {
      for (const chain of chains) {
        await handlePendingTransaction({
          chainCode: chain.chainParams.chainCode,
          type,
        });
      }
    }
  } catch (error) {
    handleChainError({
      logMessage: `Failed to check and replace pending transactions: ${error}`,
      consoleMessage: error,
    });
  }
};
