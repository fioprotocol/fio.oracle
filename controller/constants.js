export const LOG_DIRECTORY_PATH_NAME = "controller/api/logs/"; //log events and errors on FIO side

export const LOG_FILES_PATH_NAMES = {
    FIO: LOG_DIRECTORY_PATH_NAME + "FIO.log", //log events and errors on FIO side
    ETH: LOG_DIRECTORY_PATH_NAME + "ETH.log", //log events and errors on ETH side
    MATIC: LOG_DIRECTORY_PATH_NAME + "MATIC.log",
    blockNumberFIO: LOG_DIRECTORY_PATH_NAME + "blockNumberFIO.log", //store FIO blockNumber for the wrapAction
    blockNumberUnwrapTokensETH: LOG_DIRECTORY_PATH_NAME + "blockNumberETH.log", //store ETH blockNumber for the unwrap tokens action
    blockNumberUnwrapDomainETH: LOG_DIRECTORY_PATH_NAME + "blockNumberDomainETH.log", //store ETH blockNumber for the unwrap domain action
    blockNumberUnwrapDomainPolygon: LOG_DIRECTORY_PATH_NAME + "blockNumberMATIC.log", //store ETH blockNumber for the unwrap domain action
    wrapTokensTransaction: LOG_DIRECTORY_PATH_NAME + "WrapTransaction.log", //store fio transaction data for wrapAction
    wrapTokensTransactionError: LOG_DIRECTORY_PATH_NAME + "WrapErrTransaction.log", //store unprocessed fio transaction data for resubmit
    oracleErrors: LOG_DIRECTORY_PATH_NAME + "Error.log", //store the error startup and else unexpected errors error
    wrapDomainTransaction: LOG_DIRECTORY_PATH_NAME + "DomainWrapTransaction.log",
    wrapDomainTransactionError: LOG_DIRECTORY_PATH_NAME + "DomainWrapErrTransaction.log",
    wrapDomainByEthTransaction: LOG_DIRECTORY_PATH_NAME + "DomainWrapEthTransaction.log",
    wrapDomainByEthTransactionError: LOG_DIRECTORY_PATH_NAME + "DomainWrapEthErrTransaction.log",
}

export const ORACLE_CACHE_KEYS = {
    isUnprocessedWrapActionsExecuting: 'isUnprocessedWrapActionsExecuting',
    isWrapTokensExecuting: 'isWrapTokensFunctionExecuting',
    isWrapDomainByETHExecuting: 'isWrapDomainByETHFunctionExecuting',
    isWrapDomainByMATICExecuting: 'isWrapDomainByMATICFunctionExecuting',
    isUnwrapDomainsOnEthExecuting: 'isUnwrapDomainsOnEthExecuting',
    isUnwrapDomainsOnPolygonExecuting: 'isUnwrapDomainsOnPolygonExecuting',
    isUnwrapTokensOnEthExecuting: 'isUnwrapTokensOnEthExecuting',
}
