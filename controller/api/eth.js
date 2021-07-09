import Web3 from "web3";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
const Tx = require('ethereumjs-tx').Transaction;
const fetch = require('node-fetch');
const fs = require('fs');
const pathETH = "controller/api/logs/ETH.log";
const pathWrapTransact = "controller/api/logs/WrapTransaction.log";
const WrapErrTransaction = "controller/api/logs/WrapErrTransaction.log";
class EthCtrl {
    constructor() {
        this.web3 = new Web3(config.web3Provider);
        this.fioContract = new this.web3.eth.Contract(fioABI, config.FIO_token);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT);
    }
    async wrapFunction(tx_id, wrapData) {// excute wrap action
        console.log("wrapData: ", wrapData)
        const quantity = wrapData.amount;
        const info = await (await fetch(process.env.ETHAPIURL)).json();
        const gasMode = process.env.USEGASAPI;
        var gasPrice = 0;
        if ((gasMode == "1" && info.status === "1")||(gasMode == "0" && parseInt(process.env.TGASPRICE) <= 0)) {
            if (process.env.GASPRICELEVEL == "average") {
                gasPrice = parseInt(info.result.ProposeGasPrice) * 1000000000;
            } else if(process.env.GASPRICELEVEL == "low") {
                gasPrice = parseInt(info.result.SafeGasPrice) * 1000000000;
            } else if(process.env.GASPRICELEVEL == "high") {
                gasPrice = parseInt(info.result.FastGasPrice) * 1000000000;
            }
        } else if (gasMode == "0"||(gasMode == "1" && info.status === "0")){
            gasPrice = parseInt(process.env.TGASPRICE);
        }
        const regedOracle = await this.fioContract.methods.getOracles().call();
        if(regedOracle.length > 0 && regedOracle.includes(process.env.ETH_ORACLE_PUBLIC)) {
            this.fioContract.methods.getApproval(tx_id).call();
            var transactionCount = 0;
            try {
                const pubKey = process.env.ETH_ORACLE_PUBLIC;
                const signKey = process.env.ETH_ORACLE_PRIVATE;
                this.fioContract.methods.getApproval(tx_id).call()
                .then((response) => {
                    console.log(response);
                });
                if(this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "ETH") { //check validation if the address is ERC20 address
                    console.log("quantity: ", quantity);
                    console.log("gas: ", gasPrice);
                    const wrapFunc = this.fioContract.methods.wrap(wrapData.public_address, quantity, tx_id);
                    let wrapABI = wrapFunc.encodeABI();
                    var nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate noce value for transaction
                    console.log(signKey);    
                    const tx = new Tx(
                        {
                            gasPrice: this.web3.utils.toHex(gasPrice),
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
                        console.log(wrapData.public_address+" : "+pubKey);
                        console.log('TxHash: ', hash);
                    })
                    .on('receipt', (receipt) => {
                        console.log("completed");
                        fs.appendFileSync(pathETH, JSON.stringify(receipt)+'\n');            
                        transactionCount++;
                    })
                    if(transactionCount == 0) {
                        const wrapText = tx_id + ' ' + quantity + '\r\n';
                        fs.writeFileSync(WrapErrTransaction, wrapText); // store issued transaction to log by line-break        
                    }
                    let csvContent = fs.readFileSync(pathWrapTransact).toString().split('\r\n'); // read file and convert to array by line break
                    csvContent.shift(); // remove the the first element from array
                    var newTxId;
                    var newQuantity;
                    if (csvContent.length > 0 && csvContent[0] != '') { //check if the queue is empty
                        newTxId = csvContent[0].split(' ')[0];
                        newQuantity = Number(csvContent[0].split(' ')[1]);
                        this.wrapFunction(newTxId, newQuantity);//excuete next transaction from transaction log
                        csvContent = csvContent.join('\r\n'); // convert array back to string
                        fs.writeFileSync(pathWrapTransact, csvContent)
                    } else {
                        fs.writeFileSync(pathWrapTransact, "")
                        return 0;
                    }

                } else {
                    console.log("Invalid Address");
                }
            } catch (error) {
                console.log(error);
                fs.appendFileSync(pathETH, error+'\r\n');
            }
        }
    }
}

export default new EthCtrl();