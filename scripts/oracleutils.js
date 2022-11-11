require('dotenv').config();

const fetch = require('node-fetch');
const Web3 = require('web3');
const { Common, CustomChain } = require("@ethereumjs/common");
const { Transaction } = require("@ethereumjs/tx");

const fioABI = require('../config/ABI/FIO.json');
const fioNftABI = require('../config/ABI/FIONFT.json');
const fioNftABIonPolygon = require('../config/ABI/FIOMATICNFT.json');
const {
    getEthGasPriceSuggestion,
    calculateAverageGasPrice,
    calculateHighGasPrice,
    convertGweiToWei,
    convertWeiToGwei,
    getPolygonGasPriceSuggestion,
} = require("../controller/helpers");
const config = require("../config/config");
const {Fio} = require("@fioprotocol/fiojs");
const {TextDecoder, TextEncoder} = require("text-encoding");

const web3 = new Web3(process.env.ETHINFURA);
const polygonWeb3 = new Web3(process.env.POLYGON_INFURA);
const fioTokensEthContract = new web3.eth.Contract(fioABI, process.env.FIO_TOKEN_ETH_CONTRACT);
const fioNftEthContract = new web3.eth.Contract(fioNftABI, process.env.FIO_NFT_ETH_CONTRACT);
const fioNftPolygonContract = new web3.eth.Contract(fioNftABIonPolygon, process.env.FIO_NFT_POLYGON_CONTRACT);

const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;

const handleWrapEthAction = async ({
    address,
    amount,
    domain,
    obtId //txIdOnFioChain
}) => {
    console.log(`ETH WRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`)

    const gasPriceSuggestion = await getEthGasPriceSuggestion();

    const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
    let gasPrice = 0;
    if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.TGASPRICE) <= 0)) {
        console.log('using gasPrice value from the api:');
        if (process.env.GASPRICELEVEL === "average") {
            gasPrice = calculateAverageGasPrice(gasPriceSuggestion);
        } else if(process.env.GASPRICELEVEL === "low") {
            gasPrice = gasPriceSuggestion;
        } else if(process.env.GASPRICELEVEL === "high") {
            gasPrice = calculateHighGasPrice(gasPriceSuggestion);
        }
    } else if (!isUsingGasApi || (isUsingGasApi && gasPriceSuggestion)){
        console.log('using gasPrice value from the .env:');
        gasPrice = convertGweiToWei(process.env.TGASPRICE);
    }

    if (!gasPrice) throw new Error('Cannot set valid Gas Price value');

    const gasLimit = parseFloat(process.env.TGASLIMIT);

    console.log(`gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI), gasLimit = ${gasLimit}`)

    const oraclePublicKey = process.env.ETH_ORACLE_PUBLIC;
    const oraclePrivateKey = process.env.ETH_ORACLE_PRIVATE;

    const wrapFunction = amount ?
        fioTokensEthContract.methods.wrap(address, amount, obtId)
        : fioNftEthContract.methods.wrapnft(address, domain, obtId);

    let wrapABI = wrapFunction.encodeABI();
    const nonce = await web3.eth.getTransactionCount(oraclePublicKey, 'pending');

    const common = new Common({ chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' })

    const ethTransaction = Transaction.fromTxData(
        {
            gasPrice: web3.utils.toHex(gasPrice),
            gasLimit: web3.utils.toHex(gasLimit),
            to: process.env.FIO_TOKEN_ETH_CONTRACT,
            data: wrapABI,
            from: oraclePublicKey,
            nonce: web3.utils.toHex(nonce)
        },
        { common }
    );

    const privateKey = Buffer.from(oraclePrivateKey, 'hex');
    const serializedTx = ethTransaction.sign(privateKey).serialize().toString('hex');

    await web3.eth
        .sendSignedTransaction('0x' + serializedTx)
        .on('transactionHash', (hash) => {
            console.log(`Transaction has been signed and send into the chain. TxHash: ${hash}, nonce: ${nonce}`);
        })
        .on('receipt', (receipt) => {
            console.log("Transaction has been successfully completed in the chain.");
        })
        .on('error', (error, receipt) => {
            console.log(error.stack)
            console.log('Transaction has been failed in the chain.')

            if (receipt && receipt.blockHash && !receipt.status) console.log('It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value')
        })
}


const handleWrapPolygonAction = async ({
    address,
    domain,
    obtId //txIdOnFioChain
}) => {
    console.log(`POLYGON WRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`)

    const gasPriceSuggestion = await getPolygonGasPriceSuggestion();

    const isUsingGasApi = !!parseInt(process.env.USEGASAPI);
    let gasPrice = 0;
    if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.PGASPRICE) <= 0)) {
        console.log('using gasPrice value from the api:');
        if (process.env.GASPRICELEVEL === "average") {
            gasPrice = calculateAverageGasPrice(gasPriceSuggestion);
        } else if(process.env.GASPRICELEVEL === "low") {
            gasPrice = gasPriceSuggestion;
        } else if(process.env.GASPRICELEVEL === "high") {
            gasPrice = calculateHighGasPrice(gasPriceSuggestion);
        }
    } else if (!isUsingGasApi || (isUsingGasApi && gasPriceSuggestion)){
        console.log('using gasPrice value from the .env:');
        gasPrice = convertGweiToWei(process.env.PGASPRICE);
    }

    if (!gasPrice) throw new Error('Cannot set valid Gas Price value');

    const gasLimit = parseFloat(process.env.PGASLIMIT);

    console.log(`gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI), gasLimit = ${gasLimit}`)

    const oraclePublicKey = process.env.POLYGON_ORACLE_PUBLIC;
    const oraclePrivateKey = process.env.POLYGON_ORACLE_PRIVATE;

    const wrapDomainFunction = fioNftPolygonContract.methods.wrapnft(address, domain, obtId);
    let wrapABI = wrapDomainFunction.encodeABI();

    const common = Common.custom(process.env.MODE === 'testnet' ? CustomChain.PolygonMumbai : CustomChain.PolygonMainnet)

    const nonce = await polygonWeb3.eth.getTransactionCount(oraclePublicKey, 'pending');//calculate nonce value for transaction
    const polygonTransaction = Transaction.fromTxData(
        {
            gasPrice: polygonWeb3.utils.toHex(gasPrice),
            gasLimit: polygonWeb3.utils.toHex(gasLimit),
            to: config.FIO_NFT_POLYGON_CONTRACT,
            data: wrapABI,
            from: oraclePublicKey,
            nonce: polygonWeb3.utils.toHex(nonce),
        },
        { common }
    );

    const privateKey = Buffer.from(oraclePrivateKey, 'hex');
    const serializedTx = polygonTransaction.sign(privateKey).serialize().toString('hex');

    await polygonWeb3.eth
        .sendSignedTransaction('0x' + serializedTx)
        .on('transactionHash', (hash) => {
            console.log(`Transaction has been signed and send into the chain. TxHash: ${hash}, nonce: ${nonce}`);
        })
        .on('receipt', (receipt) => {
            console.log("Transaction has been successfully completed in the chain.");
        })
        .on('error', (error, receipt) => {
            console.log(error.stack);
            console.log('transaction has been failed in the chain.');

            if (receipt && receipt.blockHash && !receipt.status) console.log('It looks like the transaction ended out of gas. Or Oracle has already approved this ObtId. Also, check nonce value.')
        })
}

const handleUnwrapFromEthToFioChain = async ({
    address,
    amount,
    domain,
    obtId
}) => {
    console.log(`ETH UNWRAP --> address: ${address}, obtId: ${obtId}, ${amount ? `amount: ${amount}` : `domain: ${domain}`}`)

    const isUnwrappingTokens = !!parseInt(amount || '');
    const fioAddress = address;

    let contract = 'fio.oracle',
        actionName = isUnwrappingTokens ? 'unwraptokens' : 'unwrapdomain',
        oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = process.env.FIO_ORACLE_ACCOUNT;

    const fioChainInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
    const fioLastBlockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
        body: `{"block_num_or_id": ${fioChainInfo.last_irreversible_block_num}}`,
        method: 'POST'
    })).json()

    const chainId = fioChainInfo.chain_id;
    const currentDate = new Date();
    const timePlusTen = currentDate.getTime() + 10000;
    const timeInISOString = (new Date(timePlusTen)).toISOString();
    const expiration = timeInISOString.substr(0, timeInISOString.length - 1);

    const transactionActionsData = {
        fio_address: fioAddress,
        obt_id: obtId,
        actor: oracleAccount
    }

    if (isUnwrappingTokens) {
        transactionActionsData.amount = amount;
    } else transactionActionsData.domain = domain;

    const transaction = {
        expiration,
        ref_block_num: fioLastBlockInfo.block_num & 0xffff,
        ref_block_prefix: fioLastBlockInfo.ref_block_prefix,
        actions: [{
            account: contract,
            name: actionName,
            authorization: [{
                actor: oracleAccount,
                permission: 'active',
            }],
            data: transactionActionsData,
        }]
    };
    const abiMap = new Map();
    const tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
        body: `{"account_name": "fio.oracle"}`,
        method: 'POST'
    })).json()
    abiMap.set('fio.oracle', tokenRawAbi)

    const privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder: new TextDecoder(),
        textEncoder: new TextEncoder()
    });

    const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', { //execute transaction for unwrap
        body: JSON.stringify(tx),
        method: 'POST',
    });
    const transactionResult = await pushResult.json();

    if (!(transactionResult.type || transactionResult.error)) {
        console.log(`Completed:`)
    } else console.log(`Error:`)

    console.log(transactionResult)
}

const handleUnwrapFromPolygonToFioChain = async ({
    address,
    domain,
    obtId
}) => {
    console.log(`POLYGON UNWRAP --> address: ${address}, obtId: ${obtId}, domain: ${domain}`)
    let contract = 'fio.oracle',
        action = 'unwrapdomain',
        oraclePrivateKey = process.env.FIO_ORACLE_PRIVATE_KEY,
        oracleAccount = process.env.FIO_ORACLE_ACCOUNT;
    const info = await (await fetch(fioHttpEndpoint + 'v1/chain/get_info')).json();
    const blockInfo = await (await fetch(fioHttpEndpoint + 'v1/chain/get_block', {
        body: `{"block_num_or_id": ${info.last_irreversible_block_num}}`,
        method: 'POST'
    })).json()
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
                fio_address: address,
                fio_domain: domain,
                obt_id: obtId,
                actor: oracleAccount
            },
        }]
    };
    let abiMap = new Map();
    let tokenRawAbi = await (await fetch(fioHttpEndpoint + 'v1/chain/get_raw_abi', {
        body: `{"account_name": "fio.oracle"}`,
        method: 'POST'
    })).json()
    abiMap.set('fio.oracle', tokenRawAbi);

    const privateKeys = [oraclePrivateKey];

    const tx = await Fio.prepareTransaction({
        transaction,
        chainId,
        privateKeys,
        abiMap,
        textDecoder: new TextDecoder(),
        textEncoder: new TextEncoder()
    });

    const pushResult = await fetch(fioHttpEndpoint + 'v1/chain/push_transaction', {
        body: JSON.stringify(tx),
        method: 'POST',
    });

    const transactionResult = await pushResult.json();

    if (!(transactionResult.type || transactionResult.error)) {
        console.log(`Completed:`)
    } else console.log(`Error:`)

    console.log(transactionResult)
}

module.exports = {
    handleWrapEthAction,
    handleWrapPolygonAction,
    handleUnwrapFromEthToFioChain,
    handleUnwrapFromPolygonToFioChain
};
