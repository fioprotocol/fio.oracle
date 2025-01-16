import { ETH_CHAIN_NAME_CONSTANT, POLYGON_CHAIN_NAME } from '../constants/chain.js';
import { TRANSACTION_NOT_FOUND, MAX_TRANSACTION_AGE } from '../constants/transactions.js';
import { readLogFile, removePendingTransaction } from '../utils/log-files.js';
import {
  blockChainTransaction,
  getDefaultTransactionParams,
} from '../utils/transactions.js';

export const checkAndReplacePendingTransactions = async () => {
  const handlePendingTransaction = async ({ chainName }) => {
    const defaultTransactionParams = await getDefaultTransactionParams(chainName);
    const { oraclePublicKey, pendingTransactionFilePath, web3Instance } =
      defaultTransactionParams;

    const logPrefix = 'Pending transactions handle: --> ';
    try {
      const currentTime = Date.now();

      const latestNonce = Number(
        await web3Instance.eth.getTransactionCount(oraclePublicKey, 'latest'),
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
              const [hash, dataStr] = line.split(' ');
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

      // Remove transactions with nonce less than latest confirmed nonce or trasaction has been already replaced
      pendingTransactions = pendingTransactions.filter((tx) => {
        const isReplaced = pendingTransactions.some(
          (pendingTx) => pendingTx.originalTxHash === tx.hash,
        );
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

      for (const {
        action,
        chainName,
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

        if (!tx || currentTime - timestamp > MAX_TRANSACTION_AGE) {
          // If no tx - transaction not in mempool
          if (tx) {
            console.log(`${logPrefix} Found stuck transaction: ${hash}`);
          } else {
            console.log(
              `${logPrefix} Transaction ${hash} not in mempool and timed out, attempting replacement`,
            );
          }
          // Only replace the earliest stuck transaction
          await blockChainTransaction({
            action,
            chainName,
            contractActionParams,
            isReplaceTx: true,
            logPrefix,
            originalTxHash: hash,
            pendingTxNonce: pendingTxNonce,
          });
        }
      }
    } catch (error) {
      console.error(`${logPrefix} Error checking pending transactions:`, error);
    }
  };

  await handlePendingTransaction({ chainName: ETH_CHAIN_NAME_CONSTANT });

  await handlePendingTransaction({ chainName: POLYGON_CHAIN_NAME });
};
