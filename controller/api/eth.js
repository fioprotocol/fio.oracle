import Web3 from "web3";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
const Tx = require('ethereumjs-tx').Transaction;
var index = 0;
const { TextEncoder, TextDecoder } = require('text-encoding');
const fetch = require('node-fetch') 
const fs = require('fs');
const pathETH = "controller/api/logs/ETH.log";
const pathWrapTransact = "controller/api/logs/WrapTransaction.log";
const WrapErrTransaction = "controller/api/logs/WrapErrTransaction.log";
class EthCtrl {
    constructor() {
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

    async signContract(address, signKey, pubKey) { // regOralce by custodian
        const regedOracle = await this.fioContract.methods.getOracles().call();
        if (regedOracle.length > 0 && regedOracle.includes(address)) {
            if (index == this.pubArray.length) {
                return 0;
            } else  {
                index++;
                this.signContract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
            }
        }
        try {
            const regOracle = this.fioContract.methods.regoracle(address);
            let regOracleABI = regOracle.encodeABI();
            var nonce = await this.web3.eth.getTransactionCount(pubKey);
            const tx = new Tx(
                {
                  gasPrice: this.web3.utils.toHex(parseInt(process.env.GASPRICE)),
                  gasLimit: this.web3.utils.toHex(parseInt(process.env.GASLIMIT)),
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
                    this.signContract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
                    console.log(index);
                }
            })
        } catch (error) {
            if (index == this.pubArray.length) {
                return 0;
            } else  {
                index++;
                this.signContract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
            }
            console.log(error);
        }
    }
    async wrapFunction(tx_id, quantity) {// excute wrap action
        const regedOracle = await this.fioContract.methods.getOracles().call();
        const pubCustodian = process.env.CUSTODIAN_PUBLIC.split(",");//custodian public key
        const priCustodian = process.env.CUSTODIAN_PRIVATE.split(",");//custodian private key
        this.fioContract.methods.getApproval(tx_id).call();
        var transactionCount = 0;
        for (var i =0; i < 3; i++) { // loop every
            try {
                const pubKey = pubCustodian[i];
                const signKey = priCustodian[i];
                this.fioContract.methods.getApproval(tx_id).call()
                .then((response) => {
                    console.log(response);
                });

                if(this.web3.utils.isAddress(config.ownerAddress) === true) { //check validation if the address is ERC20 address
                    const wrapFunc = this.fioContract.methods.wrap(config.ownerAddress, quantity, tx_id);
                    let wrapABI = wrapFunc.encodeABI();
                    var nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate noce value for transaction
                    console.log(signKey);    
                    const tx = new Tx(
                        {
                          gasPrice: this.web3.utils.toHex(parseInt(process.env.TGASPRICE)),
                          gasLimit: this.web3.utils.toHex(parseInt(process.env.TGASLIMIT)),
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
                    await this.web3.eth//excute the sign transaction using public key and private key of oracle
                    .sendSignedTransaction('0x' + serializedTx.toString('hex'))
                    .on('transactionHash', (hash) => {
                        console.log(config.ownerAddress+" : "+pubKey);
                        console.log('TxHash: ', hash);
                    })
                    .on('receipt', (receipt) => {
                        console.log("completed");
                        fs.appendFileSync(pathETH, JSON.stringify(receipt)+'\n');
                        transactionCount++;
                    })
                } else {
                    console.log("Invalid Address");
                }
            } catch (error) {
                console.log(error);
                fs.appendFileSync(pathETH, error+'\n');
            }
        }
        if(transactionCount === 3) { //check if all oracles are signed
            let csvContent = fs.readFileSync(pathWrapTransact).toString().split('\r\n'); // read file and convert to array by line break
            csvContent.shift(); // remove the the first element from array
            var newTxId;
            var newQuantity;
            if (csvContent.length > 0) { //check if the queue is empty
                newTxId = csvContent[0].split(' ')[0];
                newQuantity = Number(csvContent[0].split(' ')[1]);
                this.wrapFunction(newTxId, newQuantity);//excuete next transaction from transaction log
            } else {
                return 0;
            }
            csvContent = csvContent.join('\r\n'); // convert array back to string
            fs.writeFileSync(pathWrapTransact, csvContent)
        } else {// if wrap action is not processed because of issue
            const wrapText = tx_id + ' ' + weiQuantity + '\r\n';
            fs.writeFileSync(WrapErrTransaction, wrapText); // store issued transaction to log by line-break
        }

    }
    async getContract() {
        this.signContract(this.oracleArray[index], this.privArray[index], this.pubArray[index]);
    }
}

export default new EthCtrl();