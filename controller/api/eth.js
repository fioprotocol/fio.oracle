import Web3 from "web3";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
const Tx = require('ethereumjs-tx').Transaction
var index = 0;
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch') 
const fs = require('fs');
const pathFIO = "controller/api/logs/FIO.log";
const pathETH = "controller/api/logs/ETH.log";
class EthCtrl {
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
        this.web3 = new Web3(config.web3Provider);
        this.fioContract = new this.web3.eth.Contract(fioABI, config.FIO_token);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT);
        this.oracleArray = Array();
        this.privArray = Array();
        this.pubArray = Array();
        this.eventData = Array();
        const pubCustodian = process.env.CUSTODIAN_PUBLIC.split(",");
        const priCustodian = process.env.CUSTODIAN_PRIVATE.split(",");
        for (var i = 0; i<3;i++) {
            for (var j = 0; j<9; j++) {
                if( i !== j) {
                    this.oracleArray.push(pubCustodian[i]);
                    this.privArray.push(priCustodian[j]);
                    this.pubArray.push(pubCustodian[j]);
                }
            }
        }
    }

    async signConract(address, signKey, pubKey) {
        const regedOracle = await this.fioContract.methods.getOracles().call();
        if (regedOracle.length > 0 && regedOracle.includes(address)) {
            if (index == this.pubArray.length) {
                return 0;
            } else  {
                index++;
                this.signConract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
            }
        }
        try {
            const regOracle = this.fioContract.methods.regoracle(address);
            let regOracleABI = regOracle.encodeABI();
            var nonce = await this.web3.eth.getTransactionCount(pubKey);
            const tx = new Tx(
                {
                  gasPrice: this.web3.utils.toHex(10000000000),
                  gasLimit: this.web3.utils.toHex(8000000),
                  to: config.FIO_token,
                  data: regOracleABI,
                  from: pubKey,
                  nonce: this.web3.utils.toHex(nonce),
                  // nonce: web3.utils.toHex(0)
                },
                { chain: 'ropsten', hardfork: 'istanbul' }
            );
            const privateKey = Buffer.from(signKey, 'hex');
            tx.sign(privateKey);
            const serializedTx = tx.serialize();
            await this.web3.eth
            .sendSignedTransaction('0x' + serializedTx.toString('hex'))
            .on('transactionHash', (hash) => {
                console.log(address+" : "+pubKey);
                console.log('TxHash: ', hash);
            })
            .on('receipt', (receipt) => {
                console.log("completed");
                if (index == this.pubArray.length) {
                    return 0;
                } else  {
                    index++;
                    this.signConract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
                    console.log(index);
                }
            })
        } catch (error) {
            if (index == this.pubArray.length) {
                return 0;
            } else  {
                index++;
                this.signConract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
            }
            console.log(error);
        }
    }
    async wrapFunction(tx_id, quantity) {
        const regedOracle = await this.fioContract.methods.getOracles().call();
        const pubCustodian = process.env.CUSTODIAN_PUBLIC.split(",");
        const priCustodian = process.env.CUSTODIAN_PRIVATE.split(",");
        this.fioContract.methods.getApproval(tx_id).call();
        for (var i =0; i < 3; i++) {
            try {
                const pubKey = pubCustodian[i];
                const signKey = priCustodian[i];
                console.log("pubkey: ",pubCustodian[i]);
                console.log("signkey: ",pubCustodian[i]);
                this.fioContract.methods.getApproval(tx_id).call()
                .then((response) => {
                    console.log(response);
                });

                if(this.web3.utils.isAddress(config.ownerAddress) === true) {
                    const wrapFunc = this.fioContract.methods.wrap(config.ownerAddress, quantity, tx_id);
                    let wrapABI = wrapFunc.encodeABI();
                    var nonce = await this.web3.eth.getTransactionCount(pubKey);
                    console.log(signKey);    
                    const tx = new Tx(
                        {
                          gasPrice: this.web3.utils.toHex(38000000000),
                          gasLimit: this.web3.utils.toHex(21000),
                          to: config.FIO_token,
                          data: wrapABI,
                          from: pubKey,
                          nonce: this.web3.utils.toHex(nonce),
                          // nonce: web3.utils.toHex(0)
                        },
                        { chain: 'ropsten', hardfork: 'istanbul' }
                    );
                    const privateKey = Buffer.from(signKey, 'hex');
                    tx.sign(privateKey);
                    const serializedTx = tx.serialize();
                    await this.web3.eth
                    .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                    .on('transactionHash', (hash) => {
                        console.log(config.ownerAddress+" : "+pubKey);
                        console.log('TxHash: ', hash);
                    })
                    .on('receipt', (receipt) => {
                        console.log("completed");
                        fs.appendFileSync(pathETH, JSON.stringify(receipt)+'\n');
                    })
                } else {
                    console.log("Invalid Address");
                }
            } catch (error) {
                console.log(error);
                fs.appendFileSync(pathETH, error+'\n');
            }
        }

    }
    async getContract() {
        this.signConract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
    }
}

export default new EthCtrl();