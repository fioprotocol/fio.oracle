import { Transaction } from '@ethereumjs/tx';

import { ETH_TOKEN_CODE, POLYGON_TOKEN_CODE } from '../constants/chain.js';

import {
  ALREADY_KNOWN_TRANSACTION,
  MAX_RETRY_TRANSACTION_ATTEMPTS,
  NONCE_TOO_LOW_ERROR,
  LOW_GAS_PRICE,
} from '../constants/transactions.js';

import { addLogMessage } from '../utils/log-files.js';
import { getGasPrice, getWeb3Balance, convertWeiToGwei } from '../utils/prices.js';

export const polygonTransaction = async ({
  amount,
  action,
  chainName,
  common,
  contract,
  contractName,
  data,
  defaultGasPrice,
  domain,
  getGasPriceSuggestionFn,
  gasLimit,
  handleSuccessedResult,
  logFilePath,
  logPrefix = '',
  manualSetGasPrice,
  oraclePrivateKey,
  oraclePublicKey,
  shouldThrowError,
  tokenCode,
  txNonce,
  updateNonce,
  web3Instance,
}) => {
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
        getGasPriceSuggestionFn,
        logPrefix,
        retryCount,
      });
    }

    const submitLogData = {
      gasPrice,
      gasLimit,
      to: contract,
      from: oraclePublicKey,
      txNonce,
    };

    if (tokenCode === ETH_TOKEN_CODE) {
      submitLogData.amount = amount;
    }

    if (tokenCode === POLYGON_TOKEN_CODE) {
      submitLogData.domain = domain;
    }

    addLogMessage({
      filePath: logFilePath,
      message: `${chainName} ${contractName} ${action} submit ${JSON.stringify(submitLogData)}}`,
    });

    // we shouldn't await it to do not block the rest of the actions
    getWeb3Balance({
      chainName,
      gasLimit,
      gasPrice,
      logPrefix,
      publicKey: oraclePublicKey,
      tokenCode,
      web3Instance,
    });

    const preparedTransaction = Transaction.fromTxData(
      {
        gasPrice: web3Instance.utils.toHex(gasPrice),
        gasLimit: web3Instance.utils.toHex(gasLimit),
        to: contract,
        data,
        from: oraclePublicKey,
        nonce: web3Instance.utils.toHex(txNonce),
      },
      { common },
    );

    const privateKey = Buffer.from(oraclePrivateKey, 'hex');
    const serializedTx = preparedTransaction.sign(privateKey).serialize().toString('hex');

    try {
      await web3Instance.eth
        .sendSignedTransaction('0x' + serializedTx)
        .on('transactionHash', (hash) => {
          console.log(
            `Transaction has been signed and send into the chain. TxHash: ${hash}, nonce: ${txNonce}`,
          );
        })
        .on('receipt', (receipt) => {
          console.log(
            logPrefix + 'Transaction has been successfully completed in the chain.',
          );
          if (handleSuccessedResult) {
            try {
              handleSuccessedResult && handleSuccessedResult(receipt);
            } catch (error) {
              console.log('RECEIPT ERROR', error);
            }
          }
        })
        .on('error', (error, receipt) => {
          console.log(logPrefix + 'Transaction has been failed in the chain.');

          if (receipt && receipt.blockHash && !receipt.status)
            console.log(
              logPrefix +
                'It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value',
            );
        });
    } catch (error) {
      console.log(logPrefix + error.stack);

      const nonceTooLowError = error.message.includes(NONCE_TOO_LOW_ERROR);
      const transactionAlreadyKnown = error.message.includes(ALREADY_KNOWN_TRANSACTION);
      const lowGasPriceError = error.message.includes(LOW_GAS_PRICE);
      const revertedByTheEvm = error.message.includes(REVERTED_BY_THE_EVM);

      if (
        retryCount < MAX_RETRY_TRANSACTION_ATTEMPTS &&
        (nonceTooLowError ||
          transactionAlreadyKnown ||
          lowGasPriceError ||
          revertedByTheEvm)
      ) {
        // Retry with an incremented nonce
        console.log(
          `Retrying (attempt ${retryCount + 1}/${MAX_RETRY_TRANSACTION_ATTEMPTS}).`,
        );

        const incrementedNonce = txNonce + 1;

        updateNonce && updateNonce(incrementedNonce);

        return signAndSendTransaction({
          txNonce: incrementedNonce,
          retryCount: retryCount + 1,
        });
      } else {
        if (shouldThrowError) throw error;
      }
    }
  };

  await signAndSendTransaction({ txNonce });
};
