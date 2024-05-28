import 'dotenv/config';
import Web3 from 'web3';
import fs from 'fs';

import config from '../../config/config.js';
import fioNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };

import {
  handlePolygonChainCommon,
  isOraclePolygonAddressValid,
} from '../utils/chain.js';
import {
  addLogMessage,
  updatePolygonNonce,
  handleLogFailedWrapItem,
  handleLogFailedBurnNFTItem,
  handlePolygonNonceValue,
  handleUpdatePendingPolygonItemsQueue,
  handleServerError,
  handleChainError,
} from '../utils/log-files.js';
import { getPolygonGasPriceSuggestion } from '../utils/prices.js';

import { polygonTransaction } from '../utils/transactions.js';

import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
} from '../constants/chain.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { DEFAULT_POLYGON_GAS_PRICE, POLYGON_GAS_LIMIT } from '../constants/prices.js';

const { FIO_NFT_POLYGON_CONTRACT, oracleCache } = config || {};

class PolyCtrl {
  constructor() {
      this.web3 = new Web3(process.env.POLYGON_INFURA);
      this.fioNftContract = new this.web3.eth.Contract(fioNftABI, FIO_NFT_POLYGON_CONTRACT);
      this.contractName = CONTRACT_NAMES.ERC_721;
  }

  async wrapFioDomain() { // execute wrap action
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue).toString().split('\r\n')[0];

    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      return;
    }

    const txIdOnFioChain = transactionToProceed.split(' ')[0];
    const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);

    const actionName = ACTION_NAMES.WRAP_DOMAIN;

    const logPrefix = `MATIC, ${actionName}, FIO tx_id: ${txIdOnFioChain}, domain: "${wrapData.fio_domain}", public_address: "${wrapData.public_address}": --> `;
    console.log(`${logPrefix} Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
          console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
          oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;
        const domainName = wrapData.fio_domain;

        try {
          const pubKey = process.env.POLYGON_ORACLE_PUBLIC;
          const signKey = process.env.POLYGON_ORACLE_PRIVATE;

          //Commented this out. It was throwing an uncaught exception.
          // todo: check if we should make wrap call (maybe just jump to read logs file) in case of already approved transaction by current oracle (do not forget to await)
          //this.fioNftContract.methods.getApproval(txIdOnFioChain).call()
          //    .then((response) => {
          //        console.log(logPrefix + 'Oracles Approvals:');
          //        console.log(response);
          //    });

          if (
            this.web3.utils.isAddress(wrapData.public_address) === true &&
            wrapData.chain_code === POLYGON_TOKEN_CODE
          ) { //check validation if the address is ERC20 address

            console.log(`${logPrefix} requesting wrap domain action for ${domainName} FIO domain to ${wrapData.public_address}`);

            const wrapDomainFunction =
              this.fioNftContract.methods.wrapnft(
                wrapData.public_address,
                wrapData.fio_domain,
                txIdOnFioChain
              );
            
            let wrapABI = wrapDomainFunction.encodeABI();

            const chainNonce = await this.web3.eth.getTransactionCount(pubKey,'pending');

            const txNonce = handlePolygonNonceValue({ chainNonce });

            const onSussessTransaction = (receipt) => {
              addLogMessage({
                filePath: LOG_FILES_PATH_NAMES.MATIC,
                message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${JSON.stringify(receipt)}`,
              });

              isTransactionProceededSuccessfully = true;
            };

            const common = handlePolygonChainCommon();

            await polygonTransaction({
              action: actionName,
              chainName: POLYGON_CHAIN_NAME,
              common,
              contract: FIO_NFT_POLYGON_CONTRACT,
              contractName: this.contractName,
              data: wrapABI,
              defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
              domain: wrapData.fio_domain,
              getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
              gasLimit: POLYGON_GAS_LIMIT,
              handleSuccessedResult: onSussessTransaction,
              logFilePath: LOG_FILES_PATH_NAMES.MATIC,
              logPrefix,
              oraclePrivateKey: signKey,
              oraclePublicKey: pubKey,
              shouldThrowError: true,
              tokenCode: POLYGON_TOKEN_CODE,
              txNonce,
              updateNonce: updatePolygonNonce,
              web3Instance: this.web3,
            });
          } else {
            console.log(`${logPrefix} Invalid Address`);
          }
        } catch (error) {
          handleChainError({
            logMessage: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${error}`,
            consoleMessage: `${logPrefix} ${error.stack}`,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath:
              LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
            txId: txIdOnFioChain,
            wrapData,
          });
        }

        handleUpdatePendingPolygonItemsQueue({
          action: this.wrapFioDomain.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
          jobIsRunningCacheKey:
            ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting,
        });
      }
    } catch (err) {
        oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);

        handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`)
    }
  }

  async burnNFTOnPolygon() {
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting))
        oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue).toString().split('\r\n')[0];
    if (transactionToProceed === '') {
        oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
        return;
    }

    const burnNFTData = JSON.parse(transactionToProceed);

    const { tokenId, obtId, domainName } = burnNFTData || {};
    const actionName = ACTION_NAMES.BURN_NFT;

    const logPrefix = `MATIC, ${actionName}, FIO obtId: ${obtId}, domain: "${domainName}", tokenId: "${tokenId}": --> `;
    console.log(logPrefix + `Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          const oraclePublicKey = process.env.POLYGON_ORACLE_PUBLIC;
          const oraclePrivateKey = process.env.POLYGON_ORACLE_PRIVATE;

          const burnNFTFunction = fioNftPolygonContract.methods.burnnft(
            tokenId,
            obtId
          );

          let burnABI = burnNFTFunction.encodeABI();

          const chainNonce = await this.web3.eth.getTransactionCount(oraclePublicKey, 'pending');

          const txNonce = handlePolygonNonceValue({ chainNonce });

          const onSussessTransaction = (receipt) => {
            addLogMessage({
              filePath: LOG_FILES_PATH_NAMES.MATIC,
              message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${JSON.stringify(receipt)}`,
            });

            isTransactionProceededSuccessfully = true;
          };

          const common = handlePolygonChainCommon();

          await polygonTransaction({
            action: actionName,
            chainName: POLYGON_CHAIN_NAME,
            common,
            contract: FIO_NFT_POLYGON_CONTRACT,
            data: burnABI,
            defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
            domain: domainName,
            getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
            gasLimit: POLYGON_GAS_LIMIT,
            handleSuccessedResult: onSussessTransaction,
            logFilePath: LOG_FILES_PATH_NAMES.MATIC,
            logPrefix,
            oraclePrivateKey,
            oraclePublicKey,
            shouldThrowError: true,
            tokenCode: POLYGON_TOKEN_CODE,
            txNonce,
            updateNonce: updatePolygonNonce,
            web3Instance: this.web3,
          });
        } catch (error) {
          handleChainError({
            logMessage: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${error}`,
            consoleMessage: logPrefix + error.stack,
          });
        }

        if (!isTransactionProceededSuccessfully) {
            handleLogFailedBurnNFTItem({
              logPrefix,
              errorLogFilePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions,
              burnData: burnNFTData,
            });
        }

        handleUpdatePendingPolygonItemsQueue({
          action: this.burnNFTOnPolygon.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting,
        });
      }
    } catch (error) {
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);

      handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`);
    }
  }
}

export default new PolyCtrl();
