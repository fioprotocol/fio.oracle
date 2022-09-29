import {LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS} from "../constants";

const fs = require('fs');
import Web3 from "web3";
const { Fio } = require('@fioprotocol/fiojs');
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch');
require('dotenv').config();
import utilCtrl from '../util';
import ethCtrl from '../api/eth';
import polygonCtrl from '../api/polygon';
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
import fioPolygonABI from "../../config/ABI/FIOMATICNFT.json"
import {
    addLogMessage, convertNativeFioIntoFio, getLastProceededBlockNumberOnEthereumChain,
    getLastProceededBlockNumberOnPolygonChain,
    handleServerError, updateBlockNumberETH,
    updateBlockNumberFIO, updateBlockNumberMATIC
} from "../helpers";

const web3 = new Web3(process.env.ETHINFURA);
const polyWeb3 = new Web3(process.env.POLYGON_INFURA);
const fioTokenContractOnEthChain = new web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
const fioNftContract = new web3.eth.Contract(fioNftABI, config.FIO_NFT_ETH_CONTRACT);
const fioPolygonNftContract = new polyWeb3.eth.Contract(fioPolygonABI, config.FIO_NFT_POLYGON_CONTRACT)
const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;

// execute unwrap action using eth transaction data and amount
const unwrapTokensFromEthToFioChain = async (obt_id, fioAmount, fioAddress) => {
    const logPrefix = `FIO, unwrapTokensFromEthToFioChain --> fioAddress :  ${fioAddress}, amount: ${convertNativeFioIntoFio(fioAmount)} FIO, obt_id: ${obt_id} `
    console.log(logPrefix + 'Start');
    try {
        let contract = 'fio.oracle',
            actionName = 'unwraptokens', //action name
            oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
            oraclePublicKey = process.env.FIO_ORACLE_PUBLIC_KEY,
            oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
            amount = fioAmount,
            obtId = obt_id;
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
                data: {
                    fio_address: fioAddress,
                    amount: amount,
                    obt_id: obtId,
                    actor: oracleAccount
                },
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

        const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', { //excute transactoin for unwrap
            body: JSON.stringify(tx),
            method: 'POST',
        });
        const transactionResult = await pushResult.json()

        console.log(logPrefix + `${(transactionResult.type || transactionResult.error) ? 'Error' : 'Result'}:`);
        console.log(transactionResult)
        addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
                chain: "FIO",
                contract: "fio.oracle",
                action: "unwraptokens",
                transaction: transactionResult
            }
        })
        console.log(logPrefix + 'End')
    } catch (err) {
        handleServerError(err, 'FIO, unwrapTokens');
    }
}

// execute unwrap action using eth transaction data and amount
const unwrapDomainFromPolygonToFioChain = async (obt_id, fioDomain, fioAddress) => {
    const logPrefix = `FIO, unwrapDomainFromPolygonToFioChain --> fioAddress :  ${fioAddress}, fioDomain: ${fioDomain} `
    console.log(logPrefix + 'Start');
    try {
        let contract = 'fio.oracle',
            action = 'unwrapdomain', //action name
            oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
            oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
            domain = fioDomain,
            obtId = obt_id;
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
        var abiMap = new Map();
        var tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
            body: `{"account_name": "fio.oracle"}`,
            method: 'POST'
        })).json()
        abiMap.set('fio.oracle', tokenRawAbi);

        var privateKeys = [oraclePrivateKey];

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

        console.log(logPrefix + `${(transactionResult.type || transactionResult.error) ? 'Error' : 'Result'}:`);
        console.log(transactionResult)
        addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
                chain: "FIO",
                contract: "fio.oracle",
                action: "unwrapdomain",
                transaction: transactionResult
            }
        });
        console.log(logPrefix + 'End')
    } catch (err) {
        handleServerError(err, 'FIO, unwrapDomain');
    }
}

class FIOCtrl {
    constructor() {}

    async handleUnprocessedWrapActions(req, res) {
        const logPrefix = 'Get latest Wrap (tokens and domains) actions on FIO chain --> ';
        console.log(logPrefix + 'Start');
        try {
            const wrapDataEvents = await utilCtrl.getUnprocessedActionsOnFioChain("fio.oracle", -1);
            const wrapDataArrayLength = wrapDataEvents ? wrapDataEvents.length : 0;

            console.log(logPrefix + `events data length : ${wrapDataArrayLength}, data:`);
            console.log(wrapDataEvents)

            if (wrapDataArrayLength > 0) {
                console.log(logPrefix + 'Gonna parse events and start execution of wrap actions, if they are not started yet')
                let isWrapTokensFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapTokensExecuting)
                let isWrapDomainByETHFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting)
                let isWrapDomainByMATICFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting)

                console.log(logPrefix + 'isWrapTokensFunctionExecuting: ' + !!isWrapTokensFunctionExecuting)
                console.log(logPrefix + 'isWrapDomainByETHFunctionExecuting: ' + !!isWrapDomainByETHFunctionExecuting)
                console.log(logPrefix + 'isWrapDomainByMATICFunctionExecuting: ' + !!isWrapDomainByMATICFunctionExecuting)

                for (let i = 0; i < wrapDataArrayLength; i++) {
                    if (wrapDataEvents[i].action_trace.act.name === "wraptokens") {// get FIO action data if wrapping action
                        const weiQuantity = wrapDataEvents[i].action_trace.act.data.amount;
                        const pub_address = wrapDataEvents[i].action_trace.act.data.public_address;
                        const tx_id = wrapDataEvents[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapDataEvents[i].action_trace.act.data);

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wraptokens",
                                transaction: wrapDataEvents[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapTokensTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (!isWrapTokensFunctionExecuting) {
                            isWrapTokensFunctionExecuting = true
                            ethCtrl.wrapFioToken(tx_id, wrapDataEvents[i].action_trace.act.data); // execute first wrap action, it will trigger further wrap actions from the log file recursively
                        }

                    } else if (wrapDataEvents[i].action_trace.act.name === "wrapdomain" && wrapDataEvents[i].action_trace.act.data.chain_code === "ETH") { // get FIO action data if wrapping domain on ETH chain
                        const pub_address = wrapDataEvents[i].action_trace.act.data.public_address;
                        const tx_id = wrapDataEvents[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapDataEvents[i].action_trace.act.data);

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wrapdomain ETH",
                                transaction: wrapDataEvents[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapDomainTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (!isWrapDomainByETHFunctionExecuting) {
                            isWrapDomainByETHFunctionExecuting = true;
                            ethCtrl.wrapDomainFunction(tx_id, wrapDataEvents[i].action_trace.act.data); // execute first wrap action, it will trigger further wrap actions from the log file recursively
                        }

                    } else if (wrapDataEvents[i].action_trace.act.name === "wrapdomain" && wrapDataEvents[i].action_trace.act.data.chain_code === "MATIC") {
                        const pub_address = wrapDataEvents[i].action_trace.act.data.public_address;
                        const tx_id = wrapDataEvents[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapDataEvents[i].action_trace.act.data);

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wrapdomain MATIC",
                                transaction: wrapDataEvents[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapDomainTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (!isWrapDomainByMATICFunctionExecuting) {
                            isWrapDomainByMATICFunctionExecuting = true;
                            polygonCtrl.wrapFioDomain(tx_id, wrapDataEvents[i].action_trace.act.data); // execute first wrap action, it will trigger further wrap actions from the log file recursively
                        }
                    }

                    updateBlockNumberFIO(wrapDataEvents[i].block_num.toString());
                }
            }
        } catch (err) {
            handleServerError(err, 'FIO, getLatestWrapAction');
        }
        console.log(logPrefix + 'End');
    }

    async handleUnprocessedUnwrapTokensActions() {
        const isJobRunning = config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapTokensOnEthExecuting)
        if (isJobRunning) return;

        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapTokensOnEthExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

        const logPrefix = `FIO, handleUnprocessedUnwrapTokensActions --> `
        console.log(logPrefix + 'Executing');

        try {
            const blocksRangeLimit = parseInt(process.env.BLOCKS_RANGE_LIMIT_ETH);

            const getEthActionsLogs = async (from, to) => {
                return await fioTokenContractOnEthChain.getPastEvents(
                    'unwrapped',
                    {
                        fromBlock: from,
                        toBlock: to,
                    },
                    async (error, events) => {
                        if (!error) {
                            return events;
                        } else {
                            console.log(logPrefix + `requesting past unwrap events, Blocks Numbers from ${from} to ${to} ETH Error:`);
                            console.log(error)
                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + error,
                            });
                        }
                    },
                );
            };

            const getUnprocessedActionsLogs = async () => {
                const lastInChainBlockNumber = await web3.eth.getBlockNumber();
                const lastProcessedBlockNumber = getLastProceededBlockNumberOnEthereumChain();

                if (lastProcessedBlockNumber > lastInChainBlockNumber)
                    throw new Error(
                        logPrefix + `Wrong start blockNumber, pls check stored value.`,
                    );

                let fromBlockNumber = lastProcessedBlockNumber + 1;

                console.log(logPrefix + `start Block Number: ${fromBlockNumber}, end Block Number: ${lastInChainBlockNumber}`);

                let result = [];
                let maxCheckedBlockNumber = 0;

                while (fromBlockNumber <= lastInChainBlockNumber) {
                    const maxAllowedBlockNumber = fromBlockNumber + blocksRangeLimit - 1;

                    const toBlockNumber =
                        maxAllowedBlockNumber > lastInChainBlockNumber
                            ? lastInChainBlockNumber
                            : maxAllowedBlockNumber;

                    maxCheckedBlockNumber = toBlockNumber;
                    updateBlockNumberETH(maxCheckedBlockNumber.toString());

                    result = [
                        ...result,
                        ...(await getEthActionsLogs(fromBlockNumber, toBlockNumber)),
                    ];

                    fromBlockNumber = toBlockNumber + 1;
                }

                console.log(logPrefix + `events list:`);
                console.log(result);
                console.log(logPrefix + `events list length: ${result.length}`);
                return result;
            };

            const data = await getUnprocessedActionsLogs();

            if (data.length > 0) {
                data.forEach((item, i) => {
                    const txId = item.transactionHash;
                    const fioAddress = item.returnValues.fioaddress;
                    const amount = parseInt(item.returnValues.amount);

                    console.log(amount)
                    console.log(typeof amount)

                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.ETH,
                        message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + JSON.stringify(item),
                    })

                    unwrapTokensFromEthToFioChain(txId, amount, fioAddress);//execute unwrap action using transaction_id and amount
                })
            }
        } catch (err) {
            handleServerError(err, 'FIO, unwrapFunction');
        }
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapTokensOnEthExecuting, false, 0);

        console.log(logPrefix + 'all necessary actions were completed successfully')
    }

    async unwrapDomainFunction() {
        try {
            const lastBlockNumber = config.oracleCache.get("ethBlockNumber");

            fioNftContract.getPastEvents('unwrapped', { // get unwrapp event from ETH using blocknumber
                // filter: {id: 1},
                fromBlock: lastBlockNumber,
                toBlock: 'latest' // todo: use infura limitation here
            }, async (error, events) => {
                if (!error) {
                    var obj = JSON.parse(JSON.stringify(events));
                    var array = Object.keys(obj)
                    console.log('events: ', events);
                    if (array.length != 0) {
                        for (var i = 0; i < array.length; i++) {
                            const txId = obj[array[i]].transactionHash;
                            const fioAddress = obj[array[i]].returnValues.fioaddress;
                            const domain = obj[array[i]].returnValues.domain;

                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(obj[array[i]]),
                            });

                            config.oracleCache.set("ethBlockNumber", obj[array[i]].blockNumber + 1, 10000);
                            fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberETH, obj[array[i]].blockNumber.toString());
                            unwrapDomainFromPolygonToFioChain(txId, domain, fioAddress);//execute unwrap action using transaction_id and amount
                        }
                    }
                } else {
                    // console.log(error)
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.ETH,
                        message: 'ETH' + ' ' + 'fio.erc721' + ' ' + 'unwraptokens' + ' ' + error,
                    });
                }
            })
        } catch (err) {
            handleServerError(err, 'FIO, unwrapDomainFunction');
        }
    }

    async handleUnprocessedUnwrapDomainActionsOnPolygon() {
        const isJobRunning = config.oracleCache.get(ORACLE_CACHE_KEYS.isUnwrapDomainsOnPolygonExecuting)
        if (isJobRunning) return;

        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapDomainsOnPolygonExecuting, true, 0); // ttl = 0 means that value shouldn't ever been expired

        const logPrefix = `FIO, handleUnprocessedUnwrapDomainActionsOnPolygon --> `
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
                            console.log(logPrefix + `requesting past unwrap events, Blocks Numbers from ${from} to ${to} MATIC Error:`);
                            console.log(error)
                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.MATIC,
                                message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + error,
                            });
                        }
                    },
                );
            };

            const getUnprocessedActionsLogs = async () => {
                const lastInChainBlockNumber = await polyWeb3.eth.getBlockNumber()
                const lastProcessedBlockNumber = getLastProceededBlockNumberOnPolygonChain();

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

                console.log(logPrefix + `events list:`);
                console.log(result);
                console.log(logPrefix + `events list length: ${result.length}`);
                return result;
            };

            const data = await getUnprocessedActionsLogs();

            if (data.length > 0) {
                data.forEach((item, i) => {
                    const txId = item.transactionHash;
                    const fioAddress = item.returnValues.fioaddress;
                    const domain = item.returnValues.domain;

                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.MATIC,
                        message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(item),
                    })

                    unwrapDomainFromPolygonToFioChain(txId, domain, fioAddress); //execute unwrap action using transaction_id and amount
                })
            }
        } catch (err) {
            handleServerError(err, 'FIO, unwrapPolygonDomainFunction');
        }
        config.oracleCache.set(ORACLE_CACHE_KEYS.isUnwrapDomainsOnPolygonExecuting, false, 0);

        console.log(logPrefix + 'all necessary actions were completed successfully');
    }
}

export default new FIOCtrl();
