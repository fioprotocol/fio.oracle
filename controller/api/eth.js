import 'dotenv/config';
import fs from 'fs';

import Web3 from 'web3';

import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIONFT.json' assert { type: 'json' };
import config from '../../config/config.js';

import {
  ACTION_NAMES,
  CONTRACT_NAMES,
  ETH_CHAIN_NAME_CONSTANT,
  ETH_TOKEN_CODE,
} from '../constants/chain.js';
import { ORACLE_CACHE_KEYS } from '../constants/cron-jobs.js';
import { NON_VALID_ORACLE_ADDRESS } from '../constants/errors.js';
import { LOG_FILES_PATH_NAMES } from '../constants/log-files.js';
import { DEFAULT_ETH_GAS_PRICE, ETH_GAS_LIMIT } from '../constants/prices.js';
import {
  handleEthChainCommon,
  isOracleEthAddressValid,
  convertNativeFioIntoFio,
} from '../utils/chain.js';
import {
  addLogMessage,
  updateEthNonce,
  handleChainError,
  handleLogFailedWrapItem,
  handleEthNonceValue,
  handleUpdatePendingPolygonItemsQueue,
  handleServerError,
} from '../utils/log-files.js';
import { getEthGasPriceSuggestion } from '../utils/prices.js';
import { polygonTransaction } from '../utils/transactions.js';

const {
  eth: { ETH_ORACLE_PUBLIC, ETH_ORACLE_PRIVATE, ETH_CONTRACT, ETH_NFT_CONTRACT },
  infura: { eth },
  oracleCache,
} = config;

class EthCtrl {
  constructor() {
    this.web3 = new Web3(eth);
    this.fioContract = new this.web3.eth.Contract(fioABI, ETH_CONTRACT);
    this.fioNftContract = new this.web3.eth.Contract(fioNftABI, ETH_NFT_CONTRACT);
  }

  // It handles both wrap actions (domain and tokens) on ETH chain, this is designed to prevent nonce collisions,
  // when asynchronous jobs make transactions with same nonce value from one address (oracle public address),
  // so it causes "replacing already existing transaction in the chain".
  async handleWrap() {
    if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting))
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

    const transactionToProceed = fs
      .readFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionQueue)
      .toString()
      .split('\r\n')[0];
    if (transactionToProceed === '') {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      return;
    }

    const wrapOracleId = transactionToProceed.split(' ')[0];
    const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);
    const { amount, chaincode, pubaddress } = wrapData || {};

    const logPrefix = `${ETH_CHAIN_NAME_CONSTANT}, ${ACTION_NAMES.WRAP_TOKENS}, FIO oracle id: "${wrapOracleId}", amount: ${convertNativeFioIntoFio(amount)} FIO, pubaddress: "${pubaddress}": --> `;
    console.log(`${logPrefix} Executing ${ACTION_NAMES.WRAP_TOKENS}.`);

    try {
      const isOracleAddressValid = await isOracleEthAddressValid();

      if (!isOracleAddressValid) {
        console.log(`${logPrefix} ${NON_VALID_ORACLE_ADDRESS}`);
        oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      } else {
        let isTransactionProceededSuccessfully = false;

        try {
          const oraclePublicKey = ETH_ORACLE_PUBLIC;
          const oraclePrivateKey = ETH_ORACLE_PRIVATE;

          if (
            this.web3.utils.isAddress(pubaddress) === true &&
            chaincode === ETH_TOKEN_CODE
          ) {
            //check validation if the address is ERC20 address
            console.log(`${logPrefix} preparing wrap action.`);
            const wrapFunction = this.fioContract.methods.wrap(
              pubaddress,
              amount,
              wrapOracleId,
            );

            const wrapABI = wrapFunction.encodeABI();

            const chainNonce = await this.web3.eth.getTransactionCount(
              oraclePublicKey,
              'pending',
            );
            const txNonce = handleEthNonceValue({ chainNonce });

            const common = handleEthChainCommon();

            const onSussessTransaction = (receipt) => {
              addLogMessage({
                filePath: LOG_FILES_PATH_NAMES.ETH,
                message: `${ETH_CHAIN_NAME_CONSTANT} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} receipt ${JSON.stringify(receipt)}`,
              });

              isTransactionProceededSuccessfully = true;
            };

            await polygonTransaction({
              amount: amount,
              action: ACTION_NAMES.WRAP_TOKENS,
              chainName: ETH_CHAIN_NAME_CONSTANT,
              common,
              contract: ETH_CONTRACT,
              contractName: CONTRACT_NAMES.ERC_20,
              data: wrapABI,
              defaultGasPrice: DEFAULT_ETH_GAS_PRICE,
              getGasPriceSuggestionFn: getEthGasPriceSuggestion,
              gasLimit: ETH_GAS_LIMIT,
              handleSuccessedResult: onSussessTransaction,
              logFilePath: LOG_FILES_PATH_NAMES.ETH,
              logPrefix,
              oraclePrivateKey,
              oraclePublicKey,
              shouldThrowError: true,
              tokenCode: ETH_TOKEN_CODE,
              txNonce,
              updateNonce: updateEthNonce,
              web3Instance: this.web3,
            });
          } else {
            console.log(logPrefix + 'Invalid Address');
          }
        } catch (error) {
          handleChainError({
            logMessage: `${ETH_CHAIN_NAME_CONSTANT} ${CONTRACT_NAMES.ERC_20} ${ACTION_NAMES.WRAP_TOKENS} ${error}`,
            consoleMessage: logPrefix + error.stack,
          });
        }

        if (!isTransactionProceededSuccessfully) {
          handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue,
            txId: wrapOracleId,
            wrapData,
          });
        }

        handleUpdatePendingPolygonItemsQueue({
          action: this.handleWrap.bind(this),
          logPrefix,
          logFilePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
          jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting,
        });
      }
    } catch (err) {
      oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting, false, 0);
      handleServerError(err, `${ETH_CHAIN_NAME_CONSTANT}, ${ACTION_NAMES.WRAP_TOKENS}`);
    }
  }
}

export default new EthCtrl();
