import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
import ethCtrl from './api/eth';
import polyCtrl from './api/polygon';
import utilCtrl from './util';
import config from '../config/config';
import Web3 from 'web3';
const fs = require('fs');
const cors = require("cors");

const route = require("express").Router();
const logDir = "controller/api/logs/";//log events and errors on FIO side
const pathFIO = logDir + "FIO.log";//log events and errors on FIO side
const pathETH = logDir + "ETH.log";//log events and errors on ETH side
const pathMATIC = logDir + "MATIC.log";
const blockNumFIO = logDir + "blockNumberFIO.log";//store FIO blocknumber for the wrapAction
const blockNumETH = logDir + "blockNumberETH.log";//store ETH blockNumber for the unwrapAction
const blockNumMATIC = logDir + "blockNumberMATIC.log";//store ETH blockNumber for the unwrapAction

const WrapTransaction = logDir + "WrapTransaction.log";//store fio transaction data for wrapAction
const WrapErrTransaction = logDir + "WrapErrTransaction.log";//store unprocessed fio transaction data for resubmit
const serverErr = logDir + "Error.log";//store the error startup error
const pathDomainWrapTransact = logDir + "DomainWrapTransaction.log";
const domainWrapErrTransaction = logDir + "DomainWrapErrTransaction.log";
class MainCtrl {
    async start(app) {
        const lastBlockNum = await utilCtrl.getInfo();
        this.web3 = new Web3(process.env.ETHINFURA);
        this.polyWeb3 = new Web3(process.env.POLYGONINFURA);
        try {
            if(fs.existsSync(logDir)) { //check if the log path exists
                console.log("The log directory exists.");
            } else {
                console.log('The log directory does not exist.');
                fs.mkdir(logDir, function(err) { //create new file
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The directory was created!");
                });
            }
            if(fs.existsSync(serverErr)) { //check file exist
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(serverErr, "", function(err) { //create new file
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
            }
            if(fs.existsSync(pathDomainWrapTransact)) { //check file exist
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(pathDomainWrapTransact, "", function(err) { //create new file
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
            }
            if(fs.existsSync(domainWrapErrTransaction)) { //check file exist
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(domainWrapErrTransaction, "", function(err) { //create new file
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
            }
            if(fs.existsSync(WrapTransaction)) { //check file exist
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(WrapTransaction, "", function(err) { //create new file
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                }); 
            }
            if(fs.existsSync(WrapErrTransaction)) {
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(WrapErrTransaction, "", function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
            }
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
            if(fs.existsSync(pathMATIC)) {
                console.log("The file exists.");
            } else {
                console.log('The file does not exist.');
                fs.writeFile(pathMATIC, "", function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
            }
            if(fs.existsSync(blockNumFIO)) {
                console.log("The file exists.");
                const lastProcessed = fs.readFileSync(blockNumFIO, 'utf8')
                config.oracleCache.set( "lastBlockNumber", parseInt(lastProcessed), 10000 );
            } else {
                console.log('The file does not exist.');
                fs.writeFile(blockNumFIO, lastBlockNum.toString(), function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
                config.oracleCache.set( "lastBlockNumber", lastBlockNum, 10000 );
            }
            if(fs.existsSync(blockNumETH)) {
                console.log("The file exists.");
                const lastProcessed = fs.readFileSync(blockNumETH, 'utf8')
                config.oracleCache.set( "ethBlockNumber", parseInt(lastProcessed), 10000 );
            } else {
                console.log('The file does not exist.');
                const latestBlockNum = await this.web3.eth.getBlockNumber();
                fs.writeFile(blockNumETH, latestBlockNum.toString(), function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
                config.oracleCache.set( "ethBlockNumber", latestBlockNum, 10000 );
            }
            if(fs.existsSync(blockNumMATIC)) {
                console.log("The file exists.");
                const lastProcessed = fs.readFileSync(blockNumMATIC, 'utf8')
                config.oracleCache.set( "polygonBlockNumber", parseInt(lastProcessed), 10000 );
            } else {
                console.log('The file does not exist.');
                const latestBlockNum = await this.polyWeb3.eth.getBlockNumber();
                fs.writeFile(blockNumMATIC, latestBlockNum.toString(), function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                });
                config.oracleCache.set( "polygonBlockNumber", latestBlockNum, 10000 );
            }
            utilCtrl.availCheck(process.env.FIO_ORACLE_ADDRESS);// fio account validation check
            // ethCtrl.getContract();
            setInterval(fioCtrl.getLatestDomainWrapAction, parseInt(process.env.POLLTIME)); //excute wrap action every 60 seconds
            setInterval(fioCtrl.getLatestWrapAction, parseInt(process.env.POLLTIME)); //excute wrap action every 60 seconds
            setInterval(fioCtrl.unwrapFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            // setInterval(fioCtrl.unwrapDomainFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds
            setInterval(fioCtrl.unwrapPolygonDomainFunction, parseInt(process.env.POLLTIME)); //excute unwrap action every 60 seconds

            this.initRoutes(app);
        } catch (err) {
            const timeStamp = new Date().toISOString();
            fs.appendFileSync(serverErr, timeStamp+' '+ err +'\r\n');
        }
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();