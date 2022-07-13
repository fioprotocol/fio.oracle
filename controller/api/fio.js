import utilCtrl from '../util';
import ethCtrl from '../api/eth';
import polygonCtrl from '../api/polygon';
import Web3 from "web3";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
import fioPolygonABI from "../../config/ABI/FIOMATICNFT.json"
const { Fio } = require('@fioprotocol/fiojs');
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch');
const web3 = new Web3(process.env.ETHINFURA);
const polyWeb3 = new Web3(process.env.POLYGON_INFURA);
const fioContract = new web3.eth.Contract(fioABI, process.env.ETH_TOKEN_CONTRACT);
const fioNftContract = new web3.eth.Contract(fioNftABI, config.FIO_NFT);
const fioPolygonNftContract = new polyWeb3.eth.Contract(fioPolygonABI, config.FIO_NFT_POLYGON)
const httpEndpoint = process.env.FIO_SERVER_URL_ACTION;
const fs = require('fs');
const pathFIO = "controller/api/logs/FIO.log";
const pathETH = "controller/api/logs/ETH.log";
const pathMATIC = "controller/api/logs/MATIC.log";
const blockNumFIO = "controller/api/logs/blockNumberFIO.log";
const blockNumETH = "controller/api/logs/blockNumberETH.log";
const blockNumMATIC = "controller/api/logs/blockNumberMATIC.log";
const pathWrapTransact = "controller/api/logs/WrapTransaction.log";
const pathDomainWrapTransact = "controller/api/logs/DomainWrapTransaction.log";
const unwrapTokens = async (obt_id, fioAmount, fioAddress) => { // excute unwrap action using eth transaction data and amount
    let contract = 'fio.oracle',
    action = 'unwraptokens', //action name
    oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
    oraclePublicKey = process.env.FIO_ORACLE_PUBLIC_KEY,
    oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
    amount = fioAmount,
    obtId = obt_id;
    const info = await (await fetch(httpEndpoint + 'v1/chain/get_info')).json();
    const blockInfo = await (await fetch(httpEndpoint + 'v1/chain/get_block', { body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`, method: 'POST' })).json()
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
                amount: amount,
                obt_id: obtId,
                actor: oracleAccount
            },
        }]
    };
    var abiMap = new Map();
    var tokenRawAbi = await  (await fetch(httpEndpoint + 'v1/chain/get_raw_abi', { body: `{"account_name": "fio.oracle"}`, method: 'POST' })).json()
    abiMap.set('fio.oracle', tokenRawAbi)

    var privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder: new TextDecoder(),
        textEncoder: new TextEncoder()
    });

    const pushResult = await fetch(httpEndpoint + 'v1/chain/push_transaction', { //excute transactoin for unwrap
        body: JSON.stringify(tx),
        method: 'POST',
    });
    const json = await pushResult.json()
    const timeStamp = new Date().toISOString();
    if (json.type) {
        console.log('Error: ', json);
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwraptokens", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log
    } else if (json.error) {
        console.log('Error: ', json)
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwraptokens", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log
    } else {
        console.log('Result: ', json)
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwraptokens", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log
    }
}
const unwrapDomain = async (obt_id, fioDomain, fioAddress) => { // excute unwrap action using eth transaction data and amount
    let contract = 'fio.oracle',
    action = 'unwrapdomain', //action name
    oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
    oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
    domain = fioDomain,
    obtId = obt_id;
    const info = await (await fetch(httpEndpoint + 'v1/chain/get_info')).json();
    const blockInfo = await (await fetch(httpEndpoint + 'v1/chain/get_block', { body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`, method: 'POST' })).json()
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
    var tokenRawAbi = await (await fetch(httpEndpoint + 'v1/chain/get_raw_abi', { body: `{"account_name": "fio.oracle"}`, method: 'POST' })).json()
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

    const pushResult = await fetch(httpEndpoint + 'v1/chain/push_transaction', { //excute transaction for unwrap
        body: JSON.stringify(tx),
        method: 'POST',
    });

    const json = await pushResult.json()
    const timeStamp = new Date().toISOString();
    if (json.type) {
        console.log('Error: ', json);
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwrapdomain", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log

    } else if (json.error) {
        console.log('Error: ', json)
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwrapdomain", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log
    } else {
        console.log('Result: ', json)
        fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "unwrapdomain", "transaction": ${JSON.stringify(json)} }\r\n`); //store error to log
    }
}
class FIOCtrl {
    constructor() {}
    
    async getLatestWrapAction(req,res) {
        const wrapData = await utilCtrl.getLatestAction("fio.oracle", -1);
        const dataLen = Object.keys(wrapData).length;
        if (dataLen != 0 ) {
            var count = 0;
            for (var i = 0; i<dataLen;i++){
                if (wrapData[i].action_trace.act.name == "wraptokens") {// get FIO action data if wrapping action
                    const timeStamp = new Date().toISOString();
                    const weiQuantity = wrapData[i].action_trace.act.data.amount;
                    const pub_address = wrapData[i].action_trace.act.data.public_address;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data) + '\r\n';
                    console.log("weiQuantity: ", weiQuantity)
                    fs.writeFileSync(blockNumFIO, wrapData[i].block_num.toString());
                    fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "wraptokens", "transaction": ${JSON.stringify(wrapData[i])} }\r\n`);

                    fs.appendFileSync(pathWrapTransact, wrapText);
                    if (count == 0) {
                        ethCtrl.wrapFunction(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                    }
                    count++;
                }
            }
        }
    }
    async getLatestDomainWrapAction(req,res) {
        const wrapData = await utilCtrl.getLatestWrapDomainAction("fio.oracle", -1);
        const dataLen = Object.keys(wrapData).length;
        if (dataLen != 0 ) {
            var count = 0;
            var polyCount = 0;
            for (var i = 0; i<dataLen;i++){

                if (wrapData[i].action_trace.act.name == "wrapdomain" && wrapData[i].action_trace.act.data.chain_code == "ETH") {// get FIO action data if wrapping action
                    const timeStamp = new Date().toISOString();
                    const pub_address = wrapData[i].action_trace.act.data.public_address;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data) + '\r\n';
                    fs.writeFileSync(blockNumFIO, wrapData[i].block_num.toString());
                    fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "wrapdomain ETH", "transaction": ${JSON.stringify(wrapData[i])} }\r\n`);
                    fs.appendFileSync(pathDomainWrapTransact, wrapText);
                    if (count == 0) {
                        ethCtrl.wrapDomainFunction(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                    }
                    count++;
                } else if(wrapData[i].action_trace.act.name == "wrapdomain" && wrapData[i].action_trace.act.data.chain_code == "MATIC") {
                    const timeStamp = new Date().toISOString();
                    const pub_address = wrapData[i].action_trace.act.data.public_address;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    const wrapText = tx_id + ' ' + JSON.stringify(wrapData[i].action_trace.act.data) + '\r\n';
                    fs.writeFileSync(blockNumFIO, wrapData[i].block_num.toString());
                    fs.appendFileSync(pathFIO, `{"timeStamp": "${timeStamp}", "chain": "FIO", "contract": "fio.oracle", "action": "wrapdomain MATIC", "transaction": ${JSON.stringify(wrapData[i])} }\r\n`);
                    fs.appendFileSync(pathDomainWrapTransact, wrapText);
                    if (polyCount == 0) {
                        polygonCtrl.wrapDomainFunction(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                    }
                    polyCount++;
                }
            }
        }
    }
    async unwrapFunction() {
        const lastBlockNumber = config.oracleCache.get("ethBlockNumber");
        fioContract.getPastEvents('unwrapped',{ // get unwrap event from ETH using blocknumber
            // filter: {id: 1},  
            fromBlock: lastBlockNumber,
            toBlock: 'latest'
        }, (error, events) => {
            if (!error) {
                var obj=JSON.parse(JSON.stringify(events));
                var array = Object.keys(obj)
                if (array.length != 0) {
                    for (var i = 0; i < array.length; i++) {
                        const timeStamp = new Date().toISOString();
                        const txId = obj[array[i]].transactionHash;
                        const amount = Number(obj[array[i]].returnValues.amount)
                        const fioAddress = obj[array[i]].returnValues.fioaddress
                        fs.appendFileSync(pathETH, timeStamp + ' ' + 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + JSON.stringify(obj[array[i]]) +'\r\n');
                        config.oracleCache.set( "ethBlockNumber", obj[array[i]].blockNumber+1, 10000 );
                        fs.writeFileSync(blockNumETH, obj[array[i]].blockNumber.toString());
                        unwrapTokens(txId, amount, fioAddress);//execute unwrap action using transaction_id and amount
                    }
                }
            } else {
                console.log(error)
                const timeStamp = new Date().toISOString();
                fs.appendFileSync(pathETH, timeStamp + ' ' + 'ETH' + ' ' + 'fio.erc20' + ' ' + 'unwraptokens' + ' ' + error +'\r\n');
            }
        })
    }

    async unwrapDomainFunction() {
        const lastBlockNumber = config.oracleCache.get("ethBlockNumber");


        fioNftContract.getPastEvents('unwrapped',{ // get unwrapp event from ETH using blocknumber
            // filter: {id: 1},  
            fromBlock: lastBlockNumber,
            toBlock: 'latest'
        }, async (error, events) => {
            if (!error){
                var obj=JSON.parse(JSON.stringify(events));
                var array = Object.keys(obj)
                console.log('events: ', events);
                if (array.length != 0) {
                    for (var i = 0; i < array.length; i++) {
                        const timeStamp = new Date().toISOString();
                        const txId = obj[array[i]].transactionHash;
                        const fioAddress = obj[array[i]].returnValues.fioaddress;
                        const domain = obj[array[i]].returnValues.domain;
                        fs.appendFileSync(pathETH, timeStamp + ' ' + 'ETH' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(obj[array[i]]) +'\r\n');
                        config.oracleCache.set( "ethBlockNumber", obj[array[i]].blockNumber+1, 10000 );
                        fs.writeFileSync(blockNumETH, obj[array[i]].blockNumber.toString());
                        unwrapDomain(txId, domain, fioAddress);//execute unwrap action using transaction_id and amount
                    }
                }
              }
              else {
                // console.log(error)
                const timeStamp = new Date().toISOString();
                fs.appendFileSync(pathETH, timeStamp + ' ' + 'ETH' + ' ' + 'fio.erc721' + ' ' + 'unwraptokens' + ' ' + error +'\r\n');
              }
        })
    }
    async unwrapPolygonDomainFunction() {
        const lastBlockNumber = config.oracleCache.get("polygonBlockNumber");
        fioPolygonNftContract.getPastEvents('unwrapped',{ // get unwrapp event from ETH using blocknumber
            // filter: {id: 1},  
            fromBlock: lastBlockNumber,
            toBlock: 'latest'
        }, async (error, events) => {
            if (!error){
                var obj=JSON.parse(JSON.stringify(events));
                var array = Object.keys(obj)
                console.log('events: ', events);
                if (array.length != 0) {
                    for (var i = 0; i < array.length; i++) {
                        const timeStamp = new Date().toISOString();
                        const txId = obj[array[i]].transactionHash;
                        const fioAddress = obj[array[i]].returnValues.fioaddress;
                        const domain = obj[array[i]].returnValues.domain;
                        fs.appendFileSync(pathMATIC, timeStamp + ' ' + 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwrapdomains' + ' ' + JSON.stringify(obj[array[i]]) +'\r\n');
                        config.oracleCache.set( "polygonBlockNumber", obj[array[i]].blockNumber+1, 10000 );
                        fs.writeFileSync(blockNumMATIC, obj[array[i]].blockNumber.toString());
                        unwrapDomain(txId, domain, fioAddress);//execute unwrap action using transaction_id and amount
                    }
                }
              }
              else {
                // console.log(error)
                const timeStamp = new Date().toISOString();
                fs.appendFileSync(pathMATIC, timeStamp + ' ' + 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'unwraptokens' + ' ' + error +'\r\n');
              }
        })
    }
}

export default new FIOCtrl();