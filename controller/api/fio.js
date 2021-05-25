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

const unwrapTokens = async (obt_id, fioAmount) => {
    let contract = 'fio.oracle',
    action = 'unwraptokens',
    oraclePrivateKey = process.env.PRIVATE_KEY,
    oraclePublicKey = process.env.PUBLIC_KEY,
    oracleAccount = 'qbxn5zhw2ypw',
    amount = fioAmount,
    obtId = obt_id,
    fioAddress = 'bp1@dapixdev';
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

    const pushResult = await fetch(httpEndpoint + 'v1/chain/push_transaction', {
        body: JSON.stringify(tx),
        method: 'POST',
    });

    const json = await pushResult.json()

    if (json.type) {
        console.log('Error: ', json);
        fs.appendFileSync(pathFIO, JSON.stringify(json));

    } else if (json.error) {
        console.log('Error: ', json)
        fs.appendFileSync(pathFIO, JSON.stringify(json));
    } else {
        console.log('Result: ', json)
        fs.appendFileSync(pathFIO, JSON.stringify(json));
    }
}
class FIOCtrl {
    constructor() {
        try {
            if(fs.existsSync(pathFIO)) {
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(pathFIO, "", function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                }); 
    
            }
            if(fs.existsSync(pathETH)) {
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(pathETH, "", function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                }); 
    
            }

        } catch (err) {
            console.error(err);
        }
    }
    
    async wrapFunction(req,res) {
        const wrapData = await utilCtrl.getLatestAction("qhh25sqpktwh", -1);
        console.log("wrapData: ",wrapData);
        const dataLen = Object.keys(wrapData).length;
        if (dataLen != 0 ) {
            for (var i = 0; i<dataLen;i++){
                if (wrapData[i].action_trace.act.data.memo == "Token Wrapping") {
                    const quantity = wrapData[i].action_trace.act.data.quantity;
                    const bn = bignumber(quantity.split(".")[0]);
                    const weiQuantity = Number(bn) * 1000000000;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    console.log(wrapData[i].block_num);
                    fs.writeFileSync('controller/api/logs/blockNumber.log', wrapData[i].block_num);
                    fs.appendFileSync(pathFIO, JSON.stringify(wrapData[i]));
                    ethCtrl.wrapFunction(tx_id, weiQuantity);
                }   
            }      
        }
    }
    async unwrapFunction() {
        const lastBlockNumber = config.oracleCache.get("ethBlockNumber");
        fioContract.getPastEvents('unwrapped',{
            // filter: {id: 1},  
            fromBlock: lastBlockNumber,
            toBlock: 'latest'
        }, (error, events) => {
            if (!error){
                console.log("events: ", events);
                var obj=JSON.parse(JSON.stringify(events));
                var array = Object.keys(obj)
                if (array.length != 0) {
                    var newNumber = obj[array[0]].blockNumber + 1;
                    config.oracleCache.set( "ethBlockNumber", newNumber, 10000 );
                    for (var i = 0; i < array.length; i++) {
                        const txId = obj[array[i]].transactionHash;
                        const amount = Number(obj[array[i]].returnValues.amount)
                        fs.appendFileSync(pathETH, JSON.stringify(obj[array[i]]));
                        unwrapTokens(txId, amount);
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