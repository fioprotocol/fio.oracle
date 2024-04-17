const LOG_DIRECTORY_PATH_NAME = "controller/api/logs/"; //log events and errors on FIO side

const LOG_FILES_PATH_NAMES = {
    FIO: LOG_DIRECTORY_PATH_NAME + "FIO.log", //log events and errors on FIO side
    ETH: LOG_DIRECTORY_PATH_NAME + "ETH.log", //log events and errors on ETH side
    MATIC: LOG_DIRECTORY_PATH_NAME + "MATIC.log",
    ethNonce: LOG_DIRECTORY_PATH_NAME + "ethNonce.log", // store last used ETH nonce to aviod too low nonce issue on concurrency calls
    polygonNonce: LOG_DIRECTORY_PATH_NAME + "polygonNonce.log", // store last used Polygon nonce to aviod too low nonce issue on concurrency calls
    blockNumberFIO: LOG_DIRECTORY_PATH_NAME + "blockNumberFIO.log", //store FIO blockNumber for the wrapAction
    blockNumberUnwrapTokensETH: LOG_DIRECTORY_PATH_NAME + "blockNumberETH.log", //store ETH blockNumber for unwrap tokens action
    blockNumberUnwrapDomainETH: LOG_DIRECTORY_PATH_NAME + "blockNumberDomainETH.log", //store ETH blockNumber for the unwrap domain action
    blockNumberUnwrapDomainPolygon: LOG_DIRECTORY_PATH_NAME + "blockNumberMATIC.log", //store ETH blockNumber for the unwrap domain action
    wrapEthTransactionQueue: LOG_DIRECTORY_PATH_NAME + "WrapTransaction.log", // log file to store fio transactions queue for wrap tokens and domains
    wrapEthTransactionErrorQueue: LOG_DIRECTORY_PATH_NAME + "WrapErrTransaction.log", // log file to store unprocessed fio transactions queue for wrap tokens and domains for resubmit
    oracleErrors: LOG_DIRECTORY_PATH_NAME + "Error.log", //store the error startup and else unexpected errors error
    wrapPolygonTransactionQueue: LOG_DIRECTORY_PATH_NAME + "DomainWrapTransaction.log",
    wrapPolygonTransactionErrorQueue: LOG_DIRECTORY_PATH_NAME + "DomainWrapErrTransaction.log",
    unwrapPolygonTransactionQueue: LOG_DIRECTORY_PATH_NAME + "UnwrapPolygonQueue.log",
    unwrapPolygonTransactionErrorQueue: LOG_DIRECTORY_PATH_NAME + "UnwrapPolygonErrQueue.log",
    unwrapEthTransactionQueue: LOG_DIRECTORY_PATH_NAME + "UnwrapEthTransactionQueue.log",
    unwrapEthTransactionErrorQueue: LOG_DIRECTORY_PATH_NAME + "UnwrapEthTransactionErrQueue.log",
}

const ORACLE_CACHE_KEYS = {
    isUnprocessedWrapActionsExecuting: 'isUnprocessedWrapActionsExecuting',
    isWrapOnEthJobExecuting: 'isWrapOnEthJobExecuting',
    isWrapOnPolygonJobExecuting: 'isWrapOnPolygonJobExecuting',
    isUnwrapOnEthJobExecuting: 'isUnwrapOnEthJobExecuting',
    isUnwrapOnPolygonJobExecuting: 'isUnwrapOnPolygonJobExecuting',
    isUnprocessedUnwrapActionsOnPolygonExecuting: 'isUnprocessedUnwrapActionsOnPolygonExecuting',
    isUnprocessedUnwrapActionsOnEthJobExecuting: 'isUnprocessedUnwrapActionsOnEthJobExecuting',
}

const POLYGON_TESTNET_CHAIN_ID = 80002;

const NONCE_TOO_LOW_ERROR = 'nonce too low';
const ALREADY_KNOWN_TRANSACTION = 'already known';

const MAX_RETRY_TRANSACTION_ATTEMPTS = 3;

module.exports = {
  ALREADY_KNOWN_TRANSACTION,
  ORACLE_CACHE_KEYS,
  LOG_FILES_PATH_NAMES,
  LOG_DIRECTORY_PATH_NAME,
  MAX_RETRY_TRANSACTION_ATTEMPTS,
  NONCE_TOO_LOW_ERROR,
  POLYGON_TESTNET_CHAIN_ID,
};
