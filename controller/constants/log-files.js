import config from '../../config/config.js';

const { mode } = config;

export const LOG_DIRECTORY_PATH_NAME = `controller/api/logs-${mode}/`; //log events and errors on FIO side

export const LOG_FILES_PATH_NAMES = {
  FIO: LOG_DIRECTORY_PATH_NAME + 'FIO.log', //log events and errors on FIO side
  ETH: LOG_DIRECTORY_PATH_NAME + 'ETH.log', //log events and errors on ETH side
  POLYGON: LOG_DIRECTORY_PATH_NAME + 'POLYGON.log',
  ethNonce: LOG_DIRECTORY_PATH_NAME + 'ethNonce.log', // store last used ETH nonce to aviod too low nonce issue on concurrency calls
  ethPendingTransactions: LOG_DIRECTORY_PATH_NAME + 'ethPendingTransactions.log', // store ETH pending transactions
  polygonNonce: LOG_DIRECTORY_PATH_NAME + 'polygonNonce.log', // store last used Polygon nonce to aviod too low nonce issue on concurrency calls
  polygonPendingTransactions: LOG_DIRECTORY_PATH_NAME + 'polygonPendingTransactions.log', // store Polygon pending transactions
  fioOracleItemId: LOG_DIRECTORY_PATH_NAME + 'fioOracleItemId.log', // store last processed fio.oracle wrapped item
  blockNumberFIOForBurnNFT: LOG_DIRECTORY_PATH_NAME + 'blockNumberFIOForBurnNFT.log', // store FIO block number for burn domain action
  blockNumberUnwrapTokensETH: LOG_DIRECTORY_PATH_NAME + 'blockNumberETH.log', //store ETH blockNumber for unwrap tokens action
  blockNumberUnwrapDomainETH: LOG_DIRECTORY_PATH_NAME + 'blockNumberDomainETH.log', //store ETH blockNumber for the unwrap domain action
  blockNumberUnwrapDomainPolygon: LOG_DIRECTORY_PATH_NAME + 'blockNumberMATIC.log', //store ETH blockNumber for the unwrap domain action
  burnNFTTransactionsQueue: LOG_DIRECTORY_PATH_NAME + 'burnNFTTransactionsQueue.log',
  burnNFTErroredTransactions: LOG_DIRECTORY_PATH_NAME + 'burnNFTErroredTransactions.log',
  wrapEthTransactionQueue: LOG_DIRECTORY_PATH_NAME + 'WrapTransaction.log', // log file to store fio transactions queue for wrap tokens and domains
  wrapEthTransactionErrorQueue: LOG_DIRECTORY_PATH_NAME + 'WrapErrTransaction.log', // log file to store unprocessed fio transactions queue for wrap tokens and domains for resubmit
  oracleErrors: LOG_DIRECTORY_PATH_NAME + 'Error.log', //store the error startup and else unexpected errors error
  wrapPolygonTransactionQueue: LOG_DIRECTORY_PATH_NAME + 'DomainWrapTransaction.log',
  wrapPolygonTransactionErrorQueue:
    LOG_DIRECTORY_PATH_NAME + 'DomainWrapErrTransaction.log',
  unwrapPolygonTransactionQueue: LOG_DIRECTORY_PATH_NAME + 'UnwrapPolygonQueue.log',
  unwrapPolygonTransactionErrorQueue:
    LOG_DIRECTORY_PATH_NAME + 'UnwrapPolygonErrQueue.log',
  unwrapEthTransactionQueue: LOG_DIRECTORY_PATH_NAME + 'UnwrapEthTransactionQueue.log',
  unwrapEthTransactionErrorQueue:
    LOG_DIRECTORY_PATH_NAME + 'UnwrapEthTransactionErrQueue.log',
};
