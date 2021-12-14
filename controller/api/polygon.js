import Web3 from "web3";
import Common from "ethereumjs-common";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIOMATICNFT.json";
import { time } from "console";
const Tx = require('ethereumjs-tx').Transaction;
const fetch = require('node-fetch');
const fs = require('fs');
const pathETH = "controller/api/logs/ETH.log";
const pathPolygon = "controller/api/logs/MATIC.log"
const pathWrapTransact = "controller/api/logs/WrapTransaction.log";
const pathDomainWrapTransact = "controller/api/logs/DomainWrapTransaction.log";
const WrapErrTransaction = "controller/api/logs/WrapErrTransaction.log";
const domainWrapErrTransaction = "controller/api/logs/DomainWrapErrTransaction.log";

class PolyCtrl {
    constructor() {
        this.web3 = new Web3(config.polygonProvider);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, config.FIO_NFT_POLYGON);
    }
    async wrapDomainFunction(tx_id, wrapData) {// excute wrap action
        const info = await (await fetch(process.env.ETHAPIURL)).json();
        const gasMode = process.env.USEGASAPI;
        const customChainParams = { name: 'matic-mumbai', chainId: 80001, networkId: 80001 }
        const common = Common.forCustomChain('goerli', customChainParams, 'istanbul');
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
        this.fioNftContract.methods.getApproval(tx_id).call();
        var transactionCount = 0;
        try {
            const pubKey = process.env.ETH_ORACLE_PUBLIC;
            const signKey = process.env.ETH_ORACLE_PRIVATE;
            this.fioNftContract.methods.getApproval(tx_id).call()
            .then((response) => {
                console.log(response);
            });
            if(this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "MATIC") { //check validation if the address is ERC20 address
                const wrapFunc = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, tx_id);
                let wrapABI = wrapFunc.encodeABI();
                var nonce = await this.web3.eth.getTransactionCount(pubKey);//calculate noce value for transaction
                console.log(signKey);    
                const tx = new Tx(
                    {
                        gasPrice: this.web3.utils.toHex(gasPrice),
                        gasLimit: this.web3.utils.toHex(parseInt(process.env.TGASLIMIT)),
                        to: config.FIO_NFT_POLYGON,
                        data: wrapABI,
                        from: pubKey,
                        nonce: this.web3.utils.toHex(nonce),
                        // nonce: web3.utils.toHex(0)
                    },
                    {common}
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
                    const timeStamp = new Date().toISOString();
                    fs.appendFileSync(pathPolygon, timeStamp + ' ' + 'ETH' + ' ' + 'fio.erc721' + ' ' + 'wrapdomain' + ' ' + JSON.stringify(receipt) +'\r\n');
                    transactionCount++;
                })
                if(transactionCount == 0) {
                    const timeStamp = new Date().toISOString();
                    const wrapText = tx_id + ' ' + JSON.stringify(wrapData) + '\r\n';
                    fs.writeFileSync(domainWrapErrTransaction, wrapText); // store issued transaction to log by line-break        
                }
                let csvContent = fs.readFileSync(pathDomainWrapTransact).toString().split('\r\n'); // read file and convert to array by line break
                csvContent.shift(); // remove the first element from array
                var newTxId;
                var newData;
                if (csvContent.length > 0 && csvContent[0] != '') { //check if the queue is empty
                    newTxId = csvContent[0].split(' ')[0];
                    newData = JSON.parse(csvContent[0].split(' ')[1]);
                    this.wrapDomainFunction(newTxId, newData);//excuete next transaction from transaction log
                    csvContent = csvContent.join('\r\n'); // convert array back to string
                    fs.writeFileSync(pathDomainWrapTransact, csvContent)
                } else {
                    fs.writeFileSync(pathDomainWrapTransact, "")
                    return 0;
                }

            } else {
                console.log("Invalid Address");
            }
        } catch (error) {
            const timeStamp = new Date().toISOString();
            fs.appendFileSync(pathPolygon, timeStamp + ' ' + 'Polygon' + ' ' + 'fio.erc721' + ' ' + 'wrapdomian' + ' ' + error +'\r\n');
        }
    }
}

export default new PolyCtrl();