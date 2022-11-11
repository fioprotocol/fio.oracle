const {
    handleUnwrapFromEthToFioChain,
    handleUnwrapFromPolygonToFioChain,
    handleWrapEthAction,
    handleWrapPolygonAction,
} = require('./oracleutils.js');

//console.log(process.env)
//console.log('process.argv', process.argv);

const args = process.argv;

const oracle = {
 usage:
 "Usage: npm run oracle ['wrap'|'unwrap'] ['tokens'|'domain'] [amount|domain] [fio handle or eth address] trxid \n \
    Examples: \n \
        npm run oracle wrap tokens 12000000000 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 \n \
        npm run oracle wrap domain fiohacker 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 \n \
        npm run oracle unwrap tokens 12000000000 alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 \n \
        npm run oracle unwrap domain fiohacker alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320",
 action: args.length > 2 ? args[2] + args[3] : 'help',
 domain: args[3] == 'domain' ? args[4] : '',
 amount: args[3] == 'tokens' ? args[4] : '',
 address: args[5],
 obtid: args[6]
}


// Be aware! You can get replacing transaction error, because of nonce collisions, when wrap\unwrap jobs from files queue are running.
// So the best way to run transaction would be to append it directly into log file queue or stop oracle job before script executing.
const main = async () => {
    try {
        let result;
        switch (oracle.action) {
            case 'help':
                console.log(oracle.usage + '\n');
                break;
            case 'wraptokens':
                await handleWrapEthAction({amount: oracle.amount, address: oracle.address, obtid: oracle.obtid});
                break;
            case 'wrapdomain':
                await handleWrapPolygonAction({domain: oracle.domain, address: oracle.address, obtid: oracle.obtid});
                break;
            case 'unwraptokens':
                await handleUnwrapFromEthToFioChain({amount: oracle.amount, address: oracle.address, obtid: oracle.obtid});
                break;
            case 'unwrapdomain':
                result = await handleUnwrapFromPolygonToFioChain({domain: oracle.domain, address: oracle.address, obtid: oracle.obtid});
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
