import { Web3Service } from './web3-services.js';
import config from '../../config/config.js';
import {
  CONTRACT_NAMES,
  ETH_TOKEN_CODE,
  POLYGON_TOKEN_CODE,
  ETH_CHAIN_NAME_CONSTANT,
  POLYGON_CHAIN_NAME,
} from '../constants/chain.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import {
  DEFAULT_ETH_GAS_PRICE,
  DEFAULT_POLYGON_GAS_PRICE,
  ETH_GAS_LIMIT,
  POLYGON_GAS_LIMIT,
} from '../constants/prices.js';

import {
  ALREADY_KNOWN_TRANSACTION,
  MAX_RETRY_TRANSACTION_ATTEMPTS,
  NONCE_TOO_LOW_ERROR,
  LOW_GAS_PRICE,
  REVERTED_BY_THE_EVM,
  ALREADY_APPROVED_HASH,
  MAX_TRANSACTION_AGE,
} from '../constants/transactions.js';
import {
  handlePolygonChainCommon,
  handleEthChainCommon,
  executeContractAction,
} from '../utils/chain.js';

import { stringifyWithBigInt } from '../utils/general.js';
import {
  addLogMessage,
  handleChainError,
  handleEthNonceValue,
  handlePolygonNonceValue,
  updateEthNonce,
  updatePolygonNonce,
} from '../utils/log-files.js';
import {
  getGasPrice,
  getWeb3Balance,
  convertWeiToGwei,
  getPolygonGasPriceSuggestion,
  getEthGasPriceSuggestion,
} from '../utils/prices.js';

const {
  eth: { ETH_ORACLE_PRIVATE, ETH_ORACLE_PUBLIC, ETH_CONTRACT },
  polygon: { POLYGON_ORACLE_PRIVATE, POLYGON_ORACLE_PUBLIC, POLYGON_CONTRACT },
} = config || {};

const CHAIN_CONFIG = {
  [ETH_CHAIN_NAME_CONSTANT]: {
    handleChainCommon: handleEthChainCommon,
    contract: ETH_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_20,
    defaultGasPrice: DEFAULT_ETH_GAS_PRICE,
    getGasPriceSuggestionFn: getEthGasPriceSuggestion,
    gasLimit: ETH_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.ETH,
    oraclePrivateKey: ETH_ORACLE_PRIVATE,
    oraclePublicKey: ETH_ORACLE_PUBLIC,
    pendingTransactionFilePath: LOG_FILES_PATH_NAMES.ethPendingTransactions,
    tokenCode: ETH_TOKEN_CODE,
    handleNonceValue: handleEthNonceValue,
    updateNonce: updateEthNonce,
    getWeb3Instance: () => Web3Service.getEthWeb3(),
  },
  [POLYGON_CHAIN_NAME]: {
    handleChainCommon: handlePolygonChainCommon,
    contract: POLYGON_CONTRACT,
    contractName: CONTRACT_NAMES.ERC_721,
    defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
    getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
    gasLimit: POLYGON_GAS_LIMIT,
    logFilePath: LOG_FILES_PATH_NAMES.POLYGON,
    oraclePrivateKey: POLYGON_ORACLE_PRIVATE,
    oraclePublicKey: POLYGON_ORACLE_PUBLIC,
    pendingTransactionFilePath: LOG_FILES_PATH_NAMES.polygonPendingTransactions,
    tokenCode: POLYGON_TOKEN_CODE,
    handleNonceValue: handlePolygonNonceValue,
    updateNonce: updatePolygonNonce,
    getWeb3Instance: () => Web3Service.getPolygonWeb3(),
  },
};

export const getDefaultTransactionParams = async (chain) => {
  const config = CHAIN_CONFIG[chain];

  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const {
    handleChainCommon,
    getWeb3Instance,
    handleNonceValue,
    oraclePublicKey,
    ...restConfig
  } = config;

  const web3Instance = getWeb3Instance();
  const common = handleChainCommon();

  const chainNonce = await web3Instance.eth.getTransactionCount(
    oraclePublicKey,
    'pending',
  );

  const txNonce = handleNonceValue({ chainNonce });

  return {
    common,
    oraclePublicKey,
    txNonce,
    web3Instance,
    ...restConfig,
  };
};

export const blockChainTransaction = async (transactionParams) => {
  const {
    action,
    chainName,
    contractActionParams,
    handleSuccessedResult,
    isReplaceTx = false,
    logPrefix = '',
    manualSetGasPrice,
    originalTxHash = null,
    pendingTxNonce,
    shouldThrowError,
  } = transactionParams;

  const data = executeContractAction({
    actionName: action,
    ...contractActionParams,
  });

  const {
    common,
    contract,
    contractName,
    defaultGasPrice,
    getGasPriceSuggestionFn,
    gasLimit,
    logFilePath,
    oraclePrivateKey,
    oraclePublicKey,
    pendingTransactionFilePath,
    tokenCode,
    txNonce,
    updateNonce,
    web3Instance,
  } = await getDefaultTransactionParams(chainName);

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
        isRetry: retryCount > 0,
        isReplace: isReplaceTx,
      });
    }

    const submitLogData = {
      gasPrice,
      gasLimit,
      to: contract,
      from: oraclePublicKey,
      txNonce,
      contractActionParams,
      ...(isReplaceTx && { replacingTx: originalTxHash }),
    };

    addLogMessage({
      filePath: logFilePath,
      message: `${chainName} ${contractName} ${action} ${isReplaceTx ? 'Replace' : ''} submit ${JSON.stringify(submitLogData)}}`,
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

    const txObject = {
      from: oraclePublicKey,
      to: contract,
      data,
      gasPrice: web3Instance.utils.toHex(gasPrice),
      gasLimit: web3Instance.utils.toHex(gasLimit),
      nonce: web3Instance.utils.toHex(txNonce),
      chainId: parseInt(common.chainId()),
      hardfork: common.hardfork(),
    };

    const privateKey = Buffer.from(oraclePrivateKey, 'hex');

    const signedTx = await web3Instance.eth.accounts.signTransaction(
      txObject,
      privateKey,
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
          // Store transaction
          addLogMessage({
            filePath: pendingTransactionFilePath,
            message: `${hash} ${JSON.stringify({
              action,
              chainName,
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
      const alreadyApprovedHash =
        error.reason && error.reason.includes(ALREADY_APPROVED_HASH);

      if (
        retryCount < MAX_RETRY_TRANSACTION_ATTEMPTS &&
        (nonceTooLowError ||
          transactionAlreadyKnown ||
          lowGasPriceError ||
          revertedByTheEvm) &&
        !alreadyApprovedHash
      ) {
        // Retry with an incremented nonce
        console.log(
          `Retrying (attempt ${retryCount + 1}/${MAX_RETRY_TRANSACTION_ATTEMPTS}).`,
        );

        let newNonce = txNonce;

        if (nonceTooLowError) {
          newNonce = txNonce + 1;

          updateNonce && updateNonce(newNonce);
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
