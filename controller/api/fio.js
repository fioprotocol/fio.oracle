require('dotenv').config();

import fs from "fs";
import Web3 from "web3";
const { Fio } = require('@fioprotocol/fiojs');
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch');
import utilCtrl from '../util';
import ethCtrl from '../api/eth';
import polygonCtrl from '../api/polygon';
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
import fioPolygonABI from "../../config/ABI/FIOMATICNFT.json"
import {
    addLogMessage,
    convertNativeFioIntoFio,
    getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping,
    getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping,
    getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping,
    handleChainError,
    handleServerError,
    updateBlockNumberForTokensUnwrappingOnETH,
    updateBlockNumberFIO,
    updateBlockNumberMATIC,
    updateBlockNumberForDomainsUnwrappingOnETH, handleLogFailedWrapItem, handleUpdatePendingWrapItemsQueue
} from "../helpers";
import {LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS} from "../constants";

const web3 = new Web3(process.env.ETHINFURA);
const polyWeb3 = new Web3(process.env.POLYGON_INFURA);
const fioTokenContractOnEthChain = new web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
const fioNftContract = new web3.eth.Contract(fioNftABI, config.FIO_NFT_ETH_CONTRACT);
const fioPolygonNftContract = new polyWeb3.eth.Contract(fioPolygonABI, config.FIO_NFT_POLYGON_CONTRACT)
const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;

// execute unwrap action job
const handleUnwrapFromEthToFioChainJob = async () => {
    if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting))
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

    const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue).toString().split('\r\n')[0];
    if (transactionToProceed === '') {
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting, false, 0);
        return;
    }

    const txIdOnEthChain = transactionToProceed.split(' ')[0];
    const unwrapData = JSON.parse(transactionToProceed.split(' ')[1]);

    const isUnwrappingTokens = !!parseInt(unwrapData.amount || '');
    const fioAddress = unwrapData.fioaddress;
    let isTransactionProceededSuccessfully = false

    const logPrefix = `FIO, unwrapFromEthToFioChainJob, ETH tx_id: "${txIdOnEthChain}", ${isUnwrappingTokens ? `amount: ${convertNativeFioIntoFio(unwrapData.amount)} wFIO` : `domain: "${unwrapData.domain}"`}, fioAddress :  "${fioAddress}": --> `
    console.log(logPrefix + 'Start');
    try {
        let contract = 'fio.oracle',
            actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain', //action name
            oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
            oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
            amount = parseInt(unwrapData.amount),
            obtId = txIdOnEthChain,
            domain = unwrapData.domain;
        const fioChainInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
        const fioLastBlockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
            body: `{"block_num_or_id": ${fioChainInfo.last_irreversible_block_num}}`,
            method: 'POST'
        })).json()

        const chainId = fioChainInfo.chain_id;
        const currentDate = new Date();
        const timePlusTen = currentDate.getTime() + 10000;
        const timeInISOString = (new Date(timePlusTen)).toISOString();
        const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

        const transactionActionsData = {
            fio_address: fioAddress,
            obt_id: obtId,
            actor: oracleAccount
        }

        if (isUnwrappingTokens) {
            transactionActionsData.amount = amount;
        } else transactionActionsData.domain = domain;

        const transaction = {
            expiration,
            ref_block_num: fioLastBlockInfo.block_num & 0xffff,
            ref_block_prefix: fioLastBlockInfo.ref_block_prefix,
            actions: [{
                account: contract,
                name: actionName,
                authorization: [{
                    actor: oracleAccount,
                    permission: 'active',
                }],
                data: transactionActionsData,
            }]
        };
        const abiMap = new Map();
        const tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
            body: `{"account_name": "fio.oracle"}`,
            method: 'POST'
        })).json()
        abiMap.set('fio.oracle', tokenRawAbi)

        const privateKeys = [oraclePrivateKey];

        const tx = await Fio.prepareTransaction({
            transaction,
            chainId,
            privateKeys,
            abiMap,
            textDecoder: new TextDecoder(),
            textEncoder: new TextEncoder()
        });

        const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', { //execute transaction for unwrap
            body: JSON.stringify(tx),
            method: 'POST',
        });
        const transactionResult = await pushResult.json();

        if (!(transactionResult.type || transactionResult.error)) {
            isTransactionProceededSuccessfully = true;
            console.log(logPrefix + `Completed:`)
        } else console.log(logPrefix + `Error:`)
        console.log(transactionResult)

        addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
                chain: "FIO",
                contract: "fio.oracle",
                action: isUnwrappingTokens ? "unwraptokens" : "unwrapdomains",
                transaction: transactionResult
            }
        })
    } catch (err) {
        handleServerError(err, 'FIO, handleUnwrapFromEthToFioChainJob');
    }

    console.log(isTransactionProceededSuccessfully)
    if (!isTransactionProceededSuccessfully) {
        handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionErrorQueue,
            txId: txIdOnEthChain,
            wrapData: unwrapData
        })
    }

    handleUpdatePendingWrapItemsQueue({
        action: handleUnwrapFromEthToFioChainJob,
        logPrefix,
        logFilePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
        jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting
    })
}

const handleUnwrapFromPolygonToFioChainJob = async () => {
    if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting))
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

    const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue).toString().split('\r\n')[0];
    if (transactionToProceed === '') {
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting, false, 0);
        return;
    }

    const txIdOnPolygonChain = transactionToProceed.split(' ')[0];
    const unwrapData = JSON.parse(transactionToProceed.split(' ')[1]);

    const fioAddress = unwrapData.fioaddress;
    let isTransactionProceededSuccessfully = false

    const logPrefix = `FIO, unwrapFromPolygonToFioChainJob, Polygon tx_id: "${txIdOnPolygonChain}", domain: "${unwrapData.domain}", fioAddress :  "${fioAddress}": --> `
    console.log(logPrefix + 'Start');

    try {
        let contract = 'fio.oracle',
            action = 'unwrapdomain', //action name
            oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
            oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
            domain = unwrapData.domain,
            obtId = txIdOnPolygonChain;
        const info = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
        const blockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
            body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`,
            method: 'POST'
        })).json()
        const chainId = info.chain_id;
        const currentDate = new Date();
        const timePlusTen = currentDate.getTime() + 10000;
        const timeInISOString = (new Date(timePlusTen)).toISOString();
        const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

        const transaction = {
            expiration,
            ref_block_num: blockInfo.block_num & 0xffff,
            ref_block_prefix: blockInfo.ref_block_prefix,
            actions: [{
                account: contract,
                name: action,
                authorization: [{
                    actor: oracleAccount,
                    permission: 'active',
                }],
                data: {
                    fio_address: fioAddress,
                    fio_domain: domain,
                    obt_id: obtId,
                    actor: oracleAccount
                },
            }]
        };
        let abiMap = new Map();
        let tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
            body: `{"account_name": "fio.oracle"}`,
            method: 'POST'
        })).json()
        abiMap.set('fio.oracle', tokenRawAbi);

        const privateKeys = [oraclePrivateKey];

        const tx = await Fio.prepareTransaction({
            transaction,
            chainId,
            privateKeys,
            abiMap,
            textDecoder: new TextDecoder(),
            textEncoder: new TextEncoder()
        });

        const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', { //excute transaction for unwrap
            body: JSON.stringify(tx),
            method: 'POST',
        });

        const transactionResult = await pushResult.json();

        if (!(transactionResult.type || transactionResult.error)) {
            isTransactionProceededSuccessfully = true;
            console.log(logPrefix + `Completed:`)
        } else console.log(logPrefix + `Error:`)
        console.log(transactionResult)

        addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
                chain: "FIO",
                contract: "fio.oracle",
                action: "unwrapdomain Polygon",
                transaction: transactionResult
            }
        });
    } catch (err) {
        handleServerError(err, 'FIO, handleUnwrapFromPolygonToFioChainJob');
    }

    if (!isTransactionProceededSuccessfully) {
        handleLogFailedWrapItem({
            logPrefix,
            errorLogFilePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionErrorQueue,
            txId: txIdOnPolygonChain,
            wrapData: unwrapData
        })
    }

    handleUpdatePendingWrapItemsQueue({
        action: handleUnwrapFromPolygonToFioChainJob,
        logPrefix,
        logFilePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
        jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting
    })
}

class FIOCtrl {
    constructor() {}

    async handleUnprocessedWrapActionsOnFioChain(req, res) {
        const logPrefix = 'FIO, Get latest Wrap (tokens and domains) actions on FIO chain --> ';

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting)) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, true, 0);
        } else {
            console.log(logPrefix + 'Job is already running')
            return
        }

        try {
            const wrapDataEvents = await utilCtrl.getUnprocessedActionsOnFioChain("fio.oracle", -1, logPrefix);
            const wrapDataArrayLength = wrapDataEvents ? wrapDataEvents.length : 0;

            console.log(logPrefix + `wrap events data length : ${wrapDataArrayLength}:`);

            if (wrapDataArrayLength > 0) {
                console.log(logPrefix + 'Gonna parse events and save them into the log files queue.')

                wrapDataEvents.forEach(eventData => {
                    if ((eventData.action_trace.act.name === "wraptokens" || eventData.action_trace.act.name === "wrapdomain") && eventData.action_trace.act.data.chain_code === "ETH") {
                        const isWrappingTokens = eventData.action_trace.act.name === "wraptokens";
                        const tx_id = eventData.action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(eventData.action_trace.act.data);

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: isWrappingTokens ? "wraptokens" : "wrapdomain ETH",
                                transaction: eventData
                            }
                        });
                        // save tx data into wrap tokens and domains queue log file
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
                            message: wrapText,
                            addTimestamp: false
                        });
                    } else if (eventData.action_trace.act.name === "wrapdomain" && eventData.action_trace.act.data.chain_code === "MATIC") {
                        const tx_id = eventData.action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(eventData.action_trace.act.data);

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wrapdomain MATIC",
                                transaction: eventData
                            }
                        });
                        // save tx data into wrap domain on Polygon queue log file
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
                            message: wrapText,
                            addTimestamp: false
                        });
                    }

                    updateBlockNumberFIO(eventData.block_num.toString());
                })
            }

            let isWrapOnEthJobExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnEthJobExecuting)
            let isWrapOnPolygonJobExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting)
            console.log(logPrefix + 'isWrapOnEthJobExecuting: ' + !!isWrapOnEthJobExecuting)
            console.log(logPrefix + 'isWrapOnPolygonJobExecuting: ' + !!isWrapOnPolygonJobExecuting)

            // start wrap job on Eth if it's not running
            if (!isWrapOnEthJobExecuting) {
                ethCtrl.handleWrap(); // execute first wrap action, it will trigger further wrap actions from the log file recursively
            }
            // start wrap job on Polygon job if it's not running
            if (!isWrapOnPolygonJobExecuting) {
                polygonCtrl.wrapFioDomain(); // execute first wrap action, it will trigger further wrap actions from the log file recursively
            }
        } catch (err) {
            handleServerError(err, 'FIO, handleUnprocessedWrapActionsOnFioChain');
        }
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedWrapActionsExecuting, false, 0);
        console.log(logPrefix + 'End');
    }

    async handleUnprocessedUnwrapActionsOnEthChainActions() {
        const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnEthChainActions --> `

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting)) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired
        } else {
            console.log(logPrefix + 'Job is already running')
            return
        }

        try {
            const blocksRangeLimit = parseInt(process.env.BLOCKS_RANGE_LIMIT_ETH);

            const getEthActionsLogs = async (from, to, isTokens = false) => {
                return await (isTokens ? fioTokenContractOnEthChain : fioNftContract).getPastEvents(
                    'unwrapped',
                    {
                        fromBlock: from,
                        toBlock: to,
                    },
                    async (error, events) => {
                        if (!error) {
                            return events;
                        } else {
                            // also this error will be caught in the catch block
                            console.log(logPrefix + `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, requesting past unwrap events, Blocks Numbers from ${from} to ${to} ETH Error:`);

                            handleChainError({
                                logMessage: `ETH ${isTokens ? 'fio.erc20 unwraptokens' : 'fio.erc721 unwrapdomains'} getPastEvents ` + error,
                                consoleMessage: error
                            });
                        }
                    },
                );
            };

            const getUnprocessedActionsLogs = async (isTokens = false) => {
                const lastInChainBlockNumber = await web3.eth.getBlockNumber();
                const lastProcessedBlockNumber = isTokens ? getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping() : getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping();

                if (lastProcessedBlockNumber > lastInChainBlockNumber)
                    throw new Error(
                        logPrefix + `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, Wrong start blockNumber, pls check stored value.`,
                    );

                let fromBlockNumber = lastProcessedBlockNumber + 1;

                console.log(logPrefix + `Unwrap ${isTokens ? 'Tokens' : 'Domain'}, start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`);

                let result = [];
                let maxCheckedBlockNumber = 0;

                while (fromBlockNumber <= lastInChainBlockNumber) {
                    const maxAllowedBlockNumber = fromBlockNumber + blocksRangeLimit - 1;

                    const toBlockNumber =
                        maxAllowedBlockNumber > lastInChainBlockNumber
                            ? lastInChainBlockNumber
                            : maxAllowedBlockNumber;

                    maxCheckedBlockNumber = toBlockNumber;
                    if (isTokens) {
                        updateBlockNumberForTokensUnwrappingOnETH(maxCheckedBlockNumber.toString());
                    } else updateBlockNumberForDomainsUnwrappingOnETH(maxCheckedBlockNumber.toString());

                    result = [
                        ...result,
                        ...(await getEthActionsLogs(fromBlockNumber, toBlockNumber, isTokens)),
                    ];

                    fromBlockNumber = toBlockNumber + 1;
                }

                console.log(logPrefix + `Unwrap ${isTokens ? 'Tokens' : 'Domain'} events list length: ${result.length}`);
                return result;
            };

            const unwrapTokensData = await getUnprocessedActionsLogs(true);
            const unwrapDomainsData = await getUnprocessedActionsLogs();

            if (unwrapTokensData.length > 0) {
                unwrapTokensData.forEach((item, i) => {
                    const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.ETH,
                        message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + JSON.stringify(item),
                    })

                    // save tx data into unwrap tokens and domains queue log file
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
                        message: logText,
                        addTimestamp: false
                    });
                })
            }
            if (unwrapDomainsData.length > 0) {
                unwrapDomainsData.forEach((item, i) => {
                    const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.ETH,
                        message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(item),
                    })

                    // save tx data into unwrap tokens and domains queue log file
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
                        message: logText,
                        addTimestamp: false
                    });
                })
            }

            let isUnwrapOnEthJobExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnEthJobExecuting)
            console.log(logPrefix + 'isUnwrapOnEthJobExecuting: ' + !!isUnwrapOnEthJobExecuting)

            // start unwrap job on Eth if it's not running
            if (!isUnwrapOnEthJobExecuting) {
                handleUnwrapFromEthToFioChainJob();
            }
        } catch (err) {
            handleServerError(err, 'FIO, handleUnprocessedUnwrapTokensOnEthChainActions');
        }
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnEthJobExecuting, false, 0);

        console.log(logPrefix + 'all necessary actions were completed successfully')
    }

    async handleUnprocessedUnwrapActionsOnPolygon() {
        const logPrefix = `FIO, handleUnprocessedUnwrapActionsOnPolygon --> `

        if (!config.oracleCache.get(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting)) {
            config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired
        } else {
            console.log(logPrefix + 'Job is already running')
            return
        }

        console.log(logPrefix + 'Executing');

        try {
            const blocksRangeLimit = parseInt(process.env.BLOCKS_RANGE_LIMIT_POLY);

            const getPolygonActionsLogs = async (from, to) => {
                return await fioPolygonNftContract.getPastEvents(
                    'unwrapped',
                    {
                        fromBlock: from,
                        toBlock: to,
                    },
                    async (error, events) => {
                        if (!error) {
                            return events;
                        } else {
                            // also this error will be caught in the catch block
                            console.log(logPrefix + `requesting past unwrap events, Blocks Numbers from ${from} to ${to} MATIC Error:`);

                            handleChainError({
                                logMessage: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + 'getPastEvents' + ' ' + error,
                                consoleMessage: error
                            });
                        }
                    },
                );
            };

            const getUnprocessedActionsLogs = async () => {
                const lastInChainBlockNumber = await polyWeb3.eth.getBlockNumber()
                const lastProcessedBlockNumber = getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping();

                if (lastProcessedBlockNumber > lastInChainBlockNumber)
                    throw new Error(
                        logPrefix + `Wrong start blockNumber, pls check stored value.`,
                    );

                let fromBlockNumber = lastProcessedBlockNumber + 1;

                console.log(logPrefix + `start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`)

                let result = [];
                let maxCheckedBlockNumber = 0;

                while (fromBlockNumber <= lastInChainBlockNumber) {
                    const maxAllowedBlockNumber = fromBlockNumber + blocksRangeLimit - 1;

                    const toBlockNumber =
                        maxAllowedBlockNumber > lastInChainBlockNumber
                            ? lastInChainBlockNumber
                            : maxAllowedBlockNumber;

                    maxCheckedBlockNumber = toBlockNumber;
                    updateBlockNumberMATIC(maxCheckedBlockNumber.toString());

                    result = [
                        ...result,
                        ...(await getPolygonActionsLogs(fromBlockNumber, toBlockNumber)),
                    ];

                    fromBlockNumber = toBlockNumber + 1;
                }

                console.log(logPrefix + `events list length: ${result.length}`);
                return result;
            };

            const data = await getUnprocessedActionsLogs();

            if (data.length > 0) {
                data.forEach((item, i) => {
                    const logText = item.transactionHash + ' ' + JSON.stringify(item.returnValues);

                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.MATIC,
                        message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(item),
                    })

                    // save tx data into unwrap tokens and domains queue log file
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
                        message: logText,
                        addTimestamp: false
                    });
                })
            }

            let isUnwrapOnPolygonJobExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapOnPolygonJobExecuting)
            console.log(logPrefix + 'isUnwrapOnEthJobExecuting: ' + !!isUnwrapOnPolygonJobExecuting)

            // start unwrap job on Polygon if it's not running
            if (!isUnwrapOnPolygonJobExecuting) {
                handleUnwrapFromPolygonToFioChainJob();
            }
        } catch (err) {
            handleServerError(err, 'FIO, handleUnprocessedUnwrapActionsOnPolygon');
        }
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnprocessedUnwrapActionsOnPolygonExecuting, false, 0);

        console.log(logPrefix + 'all necessary actions were completed successfully');
    }
}

export default new FIOCtrl();
