import {LOG_FILES_PATH_NAMES} from "../constants";

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
import {addLogMessage, handleServerError} from "../helpers";

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

        console.log(`${(transactionResult.type || transactionResult.error) ? 'Error' : 'Result'}: `, transactionResult);
        addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.FIO,
            message: {
                chain: "FIO",
                contract: "fio.oracle",
                action: "unwrapdomain",
                transaction: transactionResult
            }
        });
    } catch (err) {
        handleServerError(err, 'FIO, unwrapDomain');
    }
}

class FIOCtrl {
    constructor() {}

    async getLatestWrapAction(req,res) {
        try {
            const wrapData = await utilCtrl.getLatestAction("fio.oracle", -1);
            console.log(wrapData)
            const dataLen = Object.keys(wrapData).length;
            if (dataLen != 0) {
                var count = 0;
                for (var i = 0; i < dataLen; i++) {
                    if (wrapData[i].action_trace.act.name == "wraptokens") {// get FIO action data if wrapping action
                        const weiQuantity = wrapData[i].action_trace.act.data.amount;
                        const pub_address = wrapData[i].action_trace.act.data.public_address;
                        const tx_id = wrapData[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data);
                        console.log("weiQuantity: ", weiQuantity)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, wrapData[i].block_num.toString());

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wraptokens",
                                transaction: wrapData[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapTokensTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (count == 0) {
                            ethCtrl.wrapFioToken(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                        }
                        count++;
                    }
                }
            }
        } catch (err) {
            handleServerError(err, 'FIO, getLatestWrapAction');
        }
    }

    async getLatestDomainWrapAction(req,res) {
        console.log('Get latest Domain Wrap actions: start')
        try {
            const wrapData = await utilCtrl.getLatestWrapDomainAction("fio.oracle", -1);
            const dataLen = Object.keys(wrapData).length;
            if (dataLen != 0) {
                var count = 0;
                var polyCount = 0;
                for (var i = 0; i < dataLen; i++) {

                    if (wrapData[i].action_trace.act.name == "wrapdomain" && wrapData[i].action_trace.act.data.chain_code == "ETH") {// get FIO action data if wrapping action
                        const pub_address = wrapData[i].action_trace.act.data.public_address;
                        const tx_id = wrapData[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data);
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, wrapData[i].block_num.toString());

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wrapdomain ETH",
                                transaction: wrapData[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapDomainTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (count == 0) {
                            await ethCtrl.wrapDomainFunction(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                        }
                        count++;
                    } else if (wrapData[i].action_trace.act.name === "wrapdomain" && wrapData[i].action_trace.act.data.chain_code === "MATIC") {
                        const pub_address = wrapData[i].action_trace.act.data.public_address;
                        const tx_id = wrapData[i].action_trace.trx_id;
                        const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data);
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, wrapData[i].block_num.toString());

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.FIO,
                            message: {
                                chain: "FIO",
                                contract: "fio.oracle",
                                action: "wrapdomain MATIC",
                                transaction: wrapData[i]
                            }
                        });
                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.wrapDomainTransaction,
                            message: wrapText,
                            addTimestamp: false
                        });

                        if (polyCount === 0) {
                            await polygonCtrl.wrapFioDomain(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                        }
                        polyCount++;
                    }
                }
            }
        } catch (err) {
            handleServerError(err, 'FIO, getLatestDomainWrapAction');
        }
        console.log('Get latest Domain Wrap actions: all necessary actions were completed successfully')
    }

    async unwrapTokens() {
        const logPrefix = `FIO, unwrapFioTokens --> `
        console.log(logPrefix + 'Executing');
        try {
            const lastBlockNumber = config.oracleCache.get("ethBlockNumber");
            await fioTokenContractOnEthChain.getPastEvents('unwrapped',{ // get unwrap event from ETH using blocknumber
                // filter: {id: 1},
                fromBlock: lastBlockNumber,
                toBlock: 'latest' // todo: use infura limitation here
            }, (error, events) => {
                if (!error) {
                    let eventsObject=JSON.parse(JSON.stringify(events));
                    let eventsKeysArray = Object.keys(eventsObject)
                    if (eventsKeysArray.length > 0) {
                        for (let i = 0; i < eventsKeysArray.length; i++) {
                            const txId = eventsObject[eventsKeysArray[i]].transactionHash;
                            const amount = Number(eventsObject[eventsKeysArray[i]].returnValues.amount)
                            const fioAddress = eventsObject[eventsKeysArray[i]].returnValues.fioaddress

                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.ETH,
                                message: 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + JSON.stringify(eventsObject[eventsKeysArray[i]]),
                            });

                            config.oracleCache.set( "ethBlockNumber", eventsObject[eventsKeysArray[i]].blockNumber+1, 10000 );
                            fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberETH, eventsObject[eventsKeysArray[i]].blockNumber.toString());
                            unwrapTokensFromEthToFioChain(txId, amount, fioAddress);//execute unwrap action using transaction_id and amount
                        }
                    }
                } else {
                    console.log(logPrefix + `requesting past unwrap events from ${lastBlockNumber} ETH Block Number Error:`);
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

    async unwrapPolygonDomainFunction() {
        const logPrefix = `FIO, unwrapPolygonDomainFunction --> `
        console.log(logPrefix + 'Executing');
        try {
            const lastBlockNumber = config.oracleCache.get("polygonBlockNumber");
            fioPolygonNftContract.getPastEvents('unwrapped',{ // get unwrapp event from ETH using blocknumber
                // filter: {id: 1},
                fromBlock: lastBlockNumber,
                toBlock: 'latest'
            }, async (error, events) => {
                if (!error){
                    const obj=JSON.parse(JSON.stringify(events));
                    const array = Object.keys(obj)
                    console.log('events: ', events);
                    if (array.length != 0) {
                        for (var i = 0; i < array.length; i++) {
                            const txId = obj[array[i]].transactionHash;
                            const fioAddress = obj[array[i]].returnValues.fioaddress;
                            const domain = obj[array[i]].returnValues.domain;

                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.MATIC,
                                message: 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(obj[array[i]]),
                            });

                            config.oracleCache.set( "polygonBlockNumber", obj[array[i]].blockNumber+1, 10000 );
                            fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberMATIC, obj[array[i]].blockNumber.toString());
                            unwrapDomainFromPolygonToFioChain(txId, domain, fioAddress);//execute unwrap action using transaction_id and amount
                        }
                    }
                }
                else {
                    console.log(logPrefix + `requesting past unwrap events from ${lastBlockNumber} MATIC Block Number Error:`);
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
