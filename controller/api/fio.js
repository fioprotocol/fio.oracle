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
    addLogMessage, getLastProceededBlockNumberOnEthereumChain,
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
    const logPrefix = `FIO, unwrapTokensFromEthToFioChain --> fioAddress :  ${fioAddress}, amount: ${fioAmount}, obt_id: ${obt_id} `
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
                const isWrapTokensFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapTokensExecuting)
                const isWrapDomainByETHFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByETHExecuting)
                const isWrapDomainByMATICFunctionExecuting = config.oracleCache.get(ORACLE_CACHE_KEYS.isWrapDomainByMATICExecuting)

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
        const logPrefix = `FIO, handleUnprocessedUnwrapTokensActions --> `
        console.log(logPrefix + 'Executing');
        try {
            const lastInChainBlockNumber = await web3.eth.getBlockNumber()
            const lastProceededBlockNumber = getLastProceededBlockNumberOnEthereumChain();
            const minAllowedBlockNumber = parseFloat(lastInChainBlockNumber + '') - parseFloat(process.env.BLOCKS_RANGE_LIMIT_ETH);

            const fromBlockNumber = minAllowedBlockNumber > lastProceededBlockNumber + 1 ? minAllowedBlockNumber : lastProceededBlockNumber + 1;

            await fioTokenContractOnEthChain.getPastEvents('unwrapped',{ // get unwrap event from ETH using blocknumber
                // filter: {id: 1},
                fromBlock: fromBlockNumber,
                toBlock: lastInChainBlockNumber
            }, (error, events) => {
                if (!error) {
                    let eventsObject=JSON.parse(JSON.stringify(events));
                    let eventsKeysArray = Object.keys(eventsObject)

                    console.log(logPrefix + 'events list:');
                    console.log(events)

                    if (eventsKeysArray.length > 0) {
                        for (let i = 0; i < eventsKeysArray.length; i++) {
                            const txId = eventsObject[eventsKeysArray[i]].transactionHash;
                            const amount = Number(eventsObject[eventsKeysArray[i]].returnValues.amount)
                            const fioAddress = eventsObject[eventsKeysArray[i]].returnValues.fioaddress

                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + JSON.stringify(eventsObject[eventsKeysArray[i]]),
                            });

                            updateBlockNumberETH(eventsObject[eventsKeysArray[i]].blockNumber.toString());

                            unwrapTokensFromEthToFioChain(txId, amount, fioAddress);//execute unwrap action using transaction_id and amount
                        }
                    }
                } else {
                    console.log(logPrefix + `requesting past unwrap events from ${fromBlockNumber} ETH Block Number Error:`);
                    console.log(error)
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.ETH,
                        message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + error,
                    });
                }
            })
        } catch (err) {
            handleServerError(err, 'FIO, unwrapFunction');
        }
        console.log('Get latest unwrap actions for wFIO tokens: all necessary actions were completed successfully')
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
        const logPrefix = `FIO, handleUnprocessedUnwrapDomainActionsOnPolygon --> `
        console.log(logPrefix + 'Executing');
        try {
            const lastInChainBlockNumber = await polyWeb3.eth.getBlockNumber()
            const lastProceededBlockNumber = getLastProceededBlockNumberOnPolygonChain();
            const minAllowedBlockNumber = parseFloat(lastInChainBlockNumber + '') - parseFloat(process.env.BLOCKS_RANGE_LIMIT_POLY);

            const fromBlockNumber = minAllowedBlockNumber > lastProceededBlockNumber + 1 ? minAllowedBlockNumber : lastProceededBlockNumber + 1;

            fioPolygonNftContract.getPastEvents('unwrapped',{ // get unwrapp event from ETH using blocknumber
                // filter: {id: 1},
                fromBlock: fromBlockNumber,
                toBlock: lastInChainBlockNumber
            }, async (error, events) => {
                if (!error) {
                    const obj=JSON.parse(JSON.stringify(events));
                    const array = Object.keys(obj)
                    console.log(logPrefix + 'events list:');
                    console.log(events)

                    if (array.length > 0) {
                        for (let i = 0; i < array.length; i++) {
                            const txId = obj[array[i]].transactionHash;
                            const fioAddress = obj[array[i]].returnValues.fioaddress;
                            const domain = obj[array[i]].returnValues.domain;

                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.MATIC,
                                message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(obj[array[i]]),
                            });

                            updateBlockNumberMATIC(obj[array[i]].blockNumber.toString());

                            unwrapDomainFromPolygonToFioChain(txId, domain, fioAddress); //execute unwrap action using transaction_id and amount
                        }
                    }
                }
                else {
                    console.log(logPrefix + `requesting past unwrap events from ${fromBlockNumber} MATIC Block Number Error:`);
                    console.log(error)
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.MATIC,
                        message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwraptokens' + ' ' + error,
                    });
                }
            })
        } catch (err) {
            handleServerError(err, 'FIO, unwrapPolygonDomainFunction');
        }
    }
}

export default new FIOCtrl();
