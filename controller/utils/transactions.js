import { Web3Service } from './web3-services.js';
import config from '../../config/config.js';

import {
  ALREADY_KNOWN_TRANSACTION,
  MAX_RETRY_TRANSACTION_ATTEMPTS,
  NONCE_TOO_LOW_ERROR,
  LOW_GAS_PRICE,
  REVERTED_BY_THE_EVM,
  ALREADY_COMPLETED,
  MAX_TRANSACTION_AGE,
} from '../constants/transactions.js';
import { executeContractAction } from '../utils/chain.js';

import { stringifyWithBigInt } from '../utils/general.js';
import { LOG_FILES_KEYS, getLogFilePath } from '../utils/log-file-templates.js';
import {
  addLogMessage,
  handleChainError,
  handleNonceValue,
  updateNonce,
} from '../utils/log-files.js';
import {
  getGasPrice,
  getWeb3Balance,
  convertWeiToGwei,
  getGasPriceSuggestion,
} from '../utils/prices.js';

const { DEFAULT_HARDFORK, supportedChains } = config || {};

export const getDefaultTransactionParams = async ({ chainCode, type }) => {
  const config = supportedChains[type].find(
    (supportedChain) => supportedChain.chainParams.chainCode === chainCode,
  );

  if (!config) {
    throw new Error(`Unsupported chain: ${type} ${chainCode}`);
  }

  const { publicKey } = config;

  const web3Instance = Web3Service.getWe3Instance({ chainCode });

  const chainNonce = await web3Instance.eth.getTransactionCount(publicKey, 'pending');

  const txNonce = handleNonceValue({ chainNonce, chainCode });

  return {
    txNonce,
    web3Instance,
    ...config,
  };
};

export const blockChainTransaction = async (transactionParams) => {
  const {
    action,
    chainCode,
    contractActionParams,
    handleSuccessedResult,
    isReplaceTx = false,
    logPrefix = '',
    manualSetGasPrice,
    originalTxHash = null,
    pendingTxNonce,
    replacementAttempt = 0,
    shouldThrowError,
    type,
  } = transactionParams;

  const {
    chainParams,
    contractAddress,
    contractTypeName,
    defaultGasPrice,
    infura,
    gasLimit,
    moralis,
    privateKey,
    publicKey,
    txNonce,
    thirdweb,
    web3Instance,
  } = await getDefaultTransactionParams({ chainCode, type });

  const contract = Web3Service.getWeb3Contract({
    type,
    chainCode,
    contractAddress,
  });

  const { chainId, hardfork = DEFAULT_HARDFORK } = chainParams || {};

  const data = executeContractAction({
    actionNameType: action,
    contract,
    ...contractActionParams,
  });

  const signAndSendTransaction = async ({ txNonce, retryCount = 0 }) => {
    let gasPrice = 0;

    if (manualSetGasPrice) {
      gasPrice = manualSetGasPrice;
      console.log(
        `${logPrefix} gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI)`,
      );
    } else {
      gasPrice = await getGasPrice({
        defaultGasPrice,
        getGasPriceSuggestionFn: () =>
          getGasPriceSuggestion({
            chainCode,
            infura,
            moralis,
            thirdweb,
          }),
        logPrefix,
        isRetry: retryCount > 0,
        isReplace: isReplaceTx,
        replacementAttempt,
      });
    }

    const submitLogData = {
      gasPrice,
      gasLimit,
      to: contractAddress,
      from: publicKey,
      txNonce,
      contractActionParams,
      ...(isReplaceTx && { replacingTx: originalTxHash }),
    };

    addLogMessage({
      filePath: getLogFilePath({ key: LOG_FILES_KEYS.CHAIN, chainCode, type }),
      message: `${chainCode} ${contractTypeName} ${action} ${isReplaceTx ? 'Replace' : ''} submit ${JSON.stringify(submitLogData)}}`,
    });

    // we shouldn't await it to do not block the rest of the actions
    getWeb3Balance({
      gasLimit,
      gasPrice,
      logPrefix,
      publicKey,
      chainCode,
      web3Instance,
    });

    const txObject = {
      from: publicKey,
      to: contractAddress,
      data,
      gasPrice: web3Instance.utils.toHex(gasPrice),
      gasLimit: web3Instance.utils.toHex(gasLimit),
      nonce: web3Instance.utils.toHex(txNonce),
      chainId,
      hardfork,
    };

    // Remove '0x' prefix if present
    const privateKeyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');

    const signedTx = await web3Instance.eth.accounts.signTransaction(
      txObject,
      privateKeyBuffer,
    );

    try {
      await web3Instance.eth
        .sendSignedTransaction(signedTx.rawTransaction, {
          transactionPollingTimeout: MAX_TRANSACTION_AGE,
        })
        .on('transactionHash', (hash) => {
          console.log(
            `${isReplaceTx ? 'Replacement of' : ''} Transaction has been signed and send into the chain. TxHash: ${hash}, nonce: ${txNonce} ${isReplaceTx ? `, replacing: ${originalTxHash}` : ''}`,
          );

          // Save the nonce now that transaction is actually sent
          updateNonce({ chainCode, nonce: txNonce });

          // Store transaction
          addLogMessage({
            filePath: getLogFilePath({
              key: LOG_FILES_KEYS.PENDING_TRANSACTIONS,
              chainCode,
            }),
            message: `${hash} ${JSON.stringify({
              action,
              chainCode,
              contractActionParams,
              timestamp: Date.now(),
              isReplaceTx: isReplaceTx,
              originalTxHash: originalTxHash,
              txNonce,
            })}`,
            addTimestamp: false,
          });
        })
        .on('receipt', (receipt) => {
          console.log(
            `${logPrefix} ${isReplaceTx ? 'Replacement of' : ''} Transaction has been successfully completed in the chain.`,
          );

          if (receipt && handleSuccessedResult) {
            try {
              const parsedReceipt = stringifyWithBigInt(receipt);
              handleSuccessedResult && handleSuccessedResult(parsedReceipt);
            } catch (error) {
              console.log('RECEIPT ERROR', error);
            }
          }
        })
        .on('error', (error, receipt) => {
          console.log(`${logPrefix} Transaction has been failed in the chain.`);

          handleChainError({
            consoleMessage: `${error.message}: ${error.reason}`,
            logMessage: `${error.message}: ${error.reason}`,
          });

          if (receipt) {
            // status is BigInt after web3 updates to 4x version
            if (receipt.blockHash && receipt.status === BigInt(0))
              console.log(
                `${logPrefix} It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value`,
              );
          } else {
            console.log(`${logPrefix} No receipt available for failed transaction`);
          }
        });
    } catch (error) {
      console.log(`${logPrefix} ${error.stack}`);

      const nonceTooLowError = error.message.includes(NONCE_TOO_LOW_ERROR);
      const transactionAlreadyKnown = error.message.includes(ALREADY_KNOWN_TRANSACTION);
      const lowGasPriceError = error.message.includes(LOW_GAS_PRICE);
      const revertedByTheEvm = error.message.includes(REVERTED_BY_THE_EVM);

      // Check for "already completed" but EXCLUDE "already known"
      // "already known" means transaction is in mempool (still pending)
      // "already completed/approved/wrapped" means action was completed on contract (should not retry)
      const alreadyCompleted =
        !transactionAlreadyKnown &&
        ((error.reason && error.reason.toLowerCase().includes(ALREADY_COMPLETED)) ||
          (error.message && error.message.toLowerCase().includes(ALREADY_COMPLETED)));

      // Don't retry if action is already complete (but DO retry if transaction is "already known")
      if (alreadyCompleted) {
        console.log(
          `${logPrefix} Action already complete - not retrying (transaction was already processed)`,
        );
        if (shouldThrowError) throw error;
        return;
      }

      // Special handling for "already known" error
      // This means the transaction is already in the mempool - don't retry, just wait
      if (transactionAlreadyKnown) {
        console.log(
          `${logPrefix} Transaction already in mempool - not retrying. The pending transaction handler will monitor it.`,
        );
        // Transaction remains in pending log and will be handled by checkAndReplacePendingTransactions
        if (shouldThrowError) throw error;
        return;
      }

      if (
        retryCount < MAX_RETRY_TRANSACTION_ATTEMPTS &&
        (nonceTooLowError || lowGasPriceError || revertedByTheEvm)
      ) {
        // Retry with an incremented nonce
        console.log(
          `Retrying (attempt ${retryCount + 1}/${MAX_RETRY_TRANSACTION_ATTEMPTS}).`,
        );

        let newNonce = txNonce;

        if (nonceTooLowError) {
          newNonce = txNonce + 1;

          updateNonce({ chainCode, nonce: newNonce });
        }

        return signAndSendTransaction({
          txNonce: newNonce,
          retryCount: retryCount + 1,
        });
      } else {
        if (shouldThrowError) throw error;
      }
    }
  };

  await signAndSendTransaction({ txNonce: pendingTxNonce || txNonce });
};
