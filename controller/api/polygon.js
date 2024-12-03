import 'dotenv/config';
import fs from 'fs';

import Web3 from 'web3';

import fioNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import config from '../../config/config.js';

import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  POLYGON_CHAIN_NAME,
  POLYGON_TOKEN_CODE,
  MATIC_TOKEN_CODE,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { DEFAULT_POLYGON_GAS_PRICE, POLYGON_GAS_LIMIT } from '../constants/prices.js';
import { handlePolygonChainCommon, isOraclePolygonAddressValid } from '../utils/chain.js';
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

const {
  infura: { polygon },
  oracleCache,
  polygon: { POLYGON_ORACLE_PUBLIC, POLYGON_ORACLE_PRIVATE, POLYGON_CONTRACT },
} = config || {};

class PolyCtrl {
  constructor() {
    this.web3 = new Web3(polygon);
    this.fioNftContract = new this.web3.eth.Contract(fioNftABI, POLYGON_CONTRACT);
    this.contractName = CONTRACT_NAMES.ERC_721;
  }

  async wrapFioDomain() {
    // execute wrap action
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue)
      .toString()
      .split('\r\n')[0];

    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      return;
    }

    const wrapOracleId = transactionToProceed.split(' ')[0];
    const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);
    const { chaincode, nftname, pubaddress } = wrapData || {};

    const actionName = ACTION_NAMES.WRAP_DOMAIN;

    const logPrefix = `${POLYGON_TOKEN_CODE}, ${actionName}, FIO oracle id: ${wrapOracleId}, nftname: "${nftname}", pubaddress: "${pubaddress}": --> `;
    console.log(`${logPrefix} Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          const pubKey = POLYGON_ORACLE_PUBLIC;
          const signKey = POLYGON_ORACLE_PRIVATE;

          if (
            this.web3.utils.isAddress(pubaddress) === true &&
            (chaincode === MATIC_TOKEN_CODE || chaincode === POLYGON_TOKEN_CODE)
          ) {
            //check validation if the address is ERC20 address

            console.log(
              `${logPrefix} requesting wrap domain action for ${nftname} FIO domain to ${pubaddress}`,
            );

            const wrapDomainFunction = this.fioNftContract.methods.wrapnft(
              pubaddress,
              nftname,
              wrapOracleId,
            );

            const wrapABI = wrapDomainFunction.encodeABI();

            const chainNonce = await this.web3.eth.getTransactionCount(pubKey, 'pending');

            const txNonce = handlePolygonNonceValue({ chainNonce });

            const onSussessTransaction = (receipt) => {
              addLogMessage({
                filePath: LOG_FILES_PATH_NAMES.POLYGON,
                message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${JSON.stringify(receipt)}`,
              });

              isTransactionProceededSuccessfully = true;
            };

            const common = handlePolygonChainCommon();

            await polygonTransaction({
              action: actionName,
              chainName: POLYGON_CHAIN_NAME,
              common,
              contract: POLYGON_CONTRACT,
              contractName: this.contractName,
              data: wrapABI,
              defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
              domain: nftname,
              getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
              gasLimit: POLYGON_GAS_LIMIT,
              handleSuccessedResult: onSussessTransaction,
              logFilePath: LOG_FILES_PATH_NAMES.POLYGON,
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
            errorLogFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
            txId: wrapOracleId,
            wrapData,
          });
        }

        handleUpdatePendingPolygonItemsQueue({
          action: this.wrapFioDomain.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting,
        });
      }
    } catch (err) {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);

      handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`);
    }
  }

  async burnNFTOnPolygon() {
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, true, 0);

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue)
      .toString()
      .split('\r\n')[0];
    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
      return;
    }

    const burnNFTData = JSON.parse(transactionToProceed);

    const { tokenId, obtId, domainName } = burnNFTData || {};
    const actionName = ACTION_NAMES.BURN_NFT;

    const logPrefix = `${POLYGON_CHAIN_NAME}, ${actionName}, FIO obtId: ${obtId}, domain: ${domainName}, tokenId: ${tokenId}: --> `;
    console.log(logPrefix + `Executing ${actionName}.`);

    try {
      const isOracleAddressValid = await isOraclePolygonAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          const oraclePublicKey = POLYGON_ORACLE_PUBLIC;
          const oraclePrivateKey = POLYGON_ORACLE_PRIVATE;

          const burnNFTFunction = this.fioNftContract.methods.burnnft(tokenId, obtId);

          const burnABI = burnNFTFunction.encodeABI();

          const chainNonce = await this.web3.eth.getTransactionCount(
            oraclePublicKey,
            'pending',
          );

          const txNonce = handlePolygonNonceValue({ chainNonce });

          const onSussessTransaction = (receipt) => {
            addLogMessage({
              filePath: LOG_FILES_PATH_NAMES.POLYGON,
              message: `${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${JSON.stringify(receipt)}`,
            });

            isTransactionProceededSuccessfully = true;
          };

          const common = handlePolygonChainCommon();

          await polygonTransaction({
            action: actionName,
            chainName: POLYGON_CHAIN_NAME,
            common,
            contract: POLYGON_CONTRACT,
            data: burnABI,
            defaultGasPrice: DEFAULT_POLYGON_GAS_PRICE,
            domain: domainName,
            getGasPriceSuggestionFn: getPolygonGasPriceSuggestion,
            gasLimit: POLYGON_GAS_LIMIT,
            handleSuccessedResult: onSussessTransaction,
            logFilePath: LOG_FILES_PATH_NAMES.POLYGON,
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
            logMessage: `BURN ERROR ${POLYGON_CHAIN_NAME} ${this.contractName} ${actionName} ${error}`,
            consoleMessage: logPrefix + error.stack,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedBurnNFTItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions,
            burnData: JSON.stringify(burnNFTData),
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
      console.error(error);
      oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);

      handleServerError(err, `${POLYGON_CHAIN_NAME}, ${actionName}`);
    }
  }
}

export default new PolyCtrl();
