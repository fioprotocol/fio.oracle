import fioRoute from './routes/fio';
import fioCtrl from './api/fio';
// import ethCtrl from './api/eth';
import utilCtrl from './util';
import config from '../config/config';
import Web3 from "web3";
// import util from './util';
const fs = require('fs');
const cors = require("cors");
const route = require("express").Router();
const pathFIO = "controller/api/logs/FIO.log";
const pathETH = "controller/api/logs/ETH.log";
const blockNumFIO = "controller/api/logs/blockNumberFIO.log";
const blockNumETH = "controller/api/logs/blockNumberETH.log";

class MainCtrl {
    async start(app) {
        const lastBlockNum = await utilCtrl.getInfo();
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
            if(fs.existsSync(blockNumFIO)) {
                console.log("The file exists.");
                const lastProcessed = fs.readFileSync(blockNumFIO, 'utf8')
                config.oracleCache.set( "lastBlockNumber", parseInt(lastProcessed), 10000 );
            } else {
                console.log('The file does not exist.');
                fs.writeFile(blockNumFIO, "", function(err) {
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
                fs.writeFile(blockNumETH, "", function(err) {
                    if(err) {
                        return console.log(err);
                    }
                    console.log("The file was saved!");
                }); 
                config.oracleCache.set( "ethBlockNumber", "0", 10000 );
            }
        } catch (err) {
            console.error(err)
        }
        this.web3 = new Web3(config.web3Provider);
        this.web3.eth.getBlockNumber()
        .then((number)=>{
            config.oracleCache.set( "ethBlockNumber", number, 10000 );
        })
        utilCtrl.availCheck("bp1@dapixdev");
        // ethCtrl.getContract();
        // ethCtrl.wrapFunction();
        setInterval(fioCtrl.wrapFunction, parseInt(process.env.POLLTIME));
        setInterval(fioCtrl.unwrapFunction, parseInt(process.env.POLLTIME));

        this.initRoutes(app);
    }
    initRoutes(app) {
        route.use(cors({ origin: "*" }));
        app.use(fioRoute);
    }
}

export default new MainCtrl();