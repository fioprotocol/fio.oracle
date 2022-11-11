const fs = require("fs");
const {
    handleUnwrapFromEthToFioChain,
    handleUnwrapFromPolygonToFioChain,
    handleWrapEthAction,
    handleWrapPolygonAction,
} = require('./oracleutils.js');
const {LOG_FILES_PATH_NAMES} = require("../controller/constants");
const {addLogMessage} = require("../controller/helpers");

//console.log(process.env)
//console.log('process.argv', process.argv);

const args = process.argv;

const oracle = {
 usage:
 "Usage: npm run oracle ['wrap'|'unwrap'] ['tokens'|'domain'] [amount|domain] [fio handle or eth address] trxid ['clean'?] \n \
    Examples: \n \
        npm run oracle wrap tokens 12000000000 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean \n \
        npm run oracle wrap domain fiohacker 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean \n \
        npm run oracle unwrap tokens 12000000000 alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean \n \
        npm run oracle unwrap domain fiohacker alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean" ,
 action: args.length > 2 ? args[2] + args[3] : 'help',
 domain: args[3] == 'domain' ? args[4] : null,
 amount: args[3] == 'tokens' ? args[4] : null,
 address: args[5],
 obtid: args[6],
 isClean: !!(args[7] && args[7] === 'clean'),
}


// Be aware! You can get replacing transaction error, when do not use 'clean' param, because of nonce collisions,
// when wrap\unwrap jobs from files queue are running.
// So the best way to run transaction would be to append it directly into log file queue or stop oracle job before script executing.
const main = async () => {
    try {
        let result;
        switch (oracle.action) {
            case 'help':
                console.log(oracle.usage + '\n');
                break;
            case 'wraptokens':
                if (oracle.isClean) {
                    const wrapText = oracle.obtid + ' ' + JSON.stringify({
                        amount: oracle.amount,
                        chain_code: "ETH",
                        public_address: oracle.address,
                    });
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
                        message: wrapText,
                        addTimestamp: false
                    });
                } else await handleWrapEthAction({amount: oracle.amount, address: oracle.address, obtId: oracle.obtid});
                break;
            case 'wrapdomain':
                if (oracle.isClean) {
                    const wrapText = oracle.obtid + ' ' + JSON.stringify({
                        fio_domain: oracle.domain,
                        chain_code: "MATIC",
                        public_address: oracle.address,
                    });
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
                        message: wrapText,
                        addTimestamp: false
                    });
                } else await handleWrapPolygonAction({domain: oracle.domain, address: oracle.address, obtId: oracle.obtid});
                break;
            case 'unwraptokens':
                if (oracle.isClean) {
                    const wrapText = oracle.obtid + ' ' + JSON.stringify({
                        amount: oracle.amount,
                        fioaddress: oracle.address,
                    });
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
                        message: wrapText,
                        addTimestamp: false
                    });
                } else await handleUnwrapFromEthToFioChain({amount: oracle.amount, address: oracle.address, obtId: oracle.obtid});
                break;
            case 'unwrapdomain':
                if (oracle.isClean) {
                    const wrapText = oracle.obtid + ' ' + JSON.stringify({
                        domain: oracle.domain,
                        fioaddress: oracle.address,
                    });
                    addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
                        message: wrapText,
                        addTimestamp: false
                    });
                } else await handleUnwrapFromPolygonToFioChain({domain: oracle.domain, address: oracle.address, obtId: oracle.obtid});
                break;
            default:
                console.log(`\nAction ${oracle.action} not found\n`);
                console.log(oracle.usage + '\n')
        }

    } catch (err) {
        console.log('\nError: ', err);
        if (err.json) {
            console.log('\nDetails: ', err.json);
        }
    }
}

main();
