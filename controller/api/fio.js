import utilCtrl from '../util';
import ethCtrl from '../api/eth';
import Web3 from "web3";
import config from "../../config/config";
import { bignumber, number } from 'mathjs';
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
const { Fio } = require('@fioprotocol/fiojs');
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch');
const web3 = new Web3(config.web3Provider);
const fioContract = new web3.eth.Contract(fioABI, config.FIO_token);
const fioNftContract = new web3.eth.Contract(fioNftABI, config.FIO_NFT);
const httpEndpoint = process.env.SERVER_URL_ACTION
const fs = require('fs');
const pathFIO = "controller/api/logs/FIO.log";
const pathETH = "controller/api/logs/ETH.log";
const blockNumFIO = "controller/api/logs/blockNumberFIO.log";
const blockNumETH = "controller/api/logs/blockNumberETH.log";
const pathWrapTransact = "controller/api/logs/WrapTransaction.log";
const unwrapTokens = async (obt_id, fioAmount) => { // excute unwrap action using eth transaction data and amount
    let contract = 'fio.oracle',
    action = 'unwraptokens', //action name
    oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
    oraclePublicKey = process.env.FIO_ORACLE_PUBLIC_KEY,
    oracleAccount = process.env.FIO_ORACLE_ACCOUNT,
    amount = fioAmount,
    obtId = obt_id,
    fioAddress = process.env.FIO_ORACLE_ADDRESS;
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
    var abiMap = new Map()
    var tokenRawAbi = await (await fetch(httpEndpoint + 'v1/chain/get_raw_abi', { body: `{"account_name": "fio.oracle"}`, method: 'POST' })).json()
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

    if (json.type) {
        console.log('Error: ', json);
        fs.appendFileSync(pathFIO, JSON.stringify(json)); //store error to log

    } else if (json.error) {
        console.log('Error: ', json)
        fs.appendFileSync(pathFIO, JSON.stringify(json));
    } else {
        console.log('Result: ', json)
        fs.appendFileSync(pathFIO, JSON.stringify(json));//store receipt to log
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
                    const weiQuantity = wrapData[i].action_trace.act.data.amount;
                    const pub_address = wrapData[i].action_trace.act.data.public_address;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    const wrapText = tx_id + ' ' + weiQuantity + ' ' + pub_address + '\r\n';
                    console.log("weiQuantity: ", weiQuantity)
                    fs.writeFileSync(blockNumFIO, wrapData[i].block_num.toString());
                    fs.appendFileSync(pathFIO, JSON.stringify(wrapData[i]));
                    fs.appendFileSync(pathWrapTransact, wrapText);
                    if (count == 0) {
                        ethCtrl.wrapFunction(tx_id, wrapData[i].action_trace.act.data);//excute first wrap action
                    }
                    count++;
                }   
            }      
        }
    }
    async unwrapFunction() {
        const lastBlockNumber = config.oracleCache.get("ethBlockNumber");
        console.log("lastBlocku: ", lastBlockNumber)
        fioContract.getPastEvents('unwrapped',{ // get unwrapp event from ETH using blocknumber
            // filter: {id: 1},  
            fromBlock: lastBlockNumber+1,
            toBlock: 'latest'
        }, (error, events) => {
            if (!error){
                console.log("events: ", events);
                var obj=JSON.parse(JSON.stringify(events));
                var array = Object.keys(obj)
                if (array.length != 0) {
                    var newNumber = obj[array[0]].blockNumber + 1;
                    for (var i = 0; i < array.length; i++) {
                        const txId = obj[array[i]].transactionHash;
                        const amount = Number(obj[array[i]].returnValues.amount)
                        fs.appendFileSync(pathETH, JSON.stringify(obj[array[i]]));
                        config.oracleCache.set( "ethBlockNumber", obj[array[i]].blockNumber, 10000 );
                        fs.writeFileSync(blockNumETH, obj[array[i]].blockNumber.toString());
                        unwrapTokens(txId, amount);//execute unwrap action using transaction_id and amount
                    }
                }
              }
              else {
                console.log(error)
                fs.appendFileSync(pathETH, error);
              }
        })
    }

}

export default new FIOCtrl();