import 'dotenv/config';
import Web3 from 'web3';
import fs from 'fs';

import config from '../../config/config.js';
import fioNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import {
    addLogMessage,
    calculateAverageGasPrice,
    calculateHighGasPrice,
    convertGweiToWei,
    convertWeiToEth,
    convertWeiToGwei,
    getPolygonGasPriceSuggestion,
    handleChainError,
    handleLogFailedWrapItem,
    handleServerError,
    handleUpdatePendingPolygonItemsQueue,
    handleLogFailedBurnNFTItem,
    handlePolygonNonceValue,
    isOraclePolygonAddressValid,
    handlePolygonChainCommon,
    polygonTransaction,
    updatePolygonNonce
} from '../helpers.js';

import { LOG_FILES_PATH_NAMES, ORACLE_CACHE_KEYS } from '../constants.js';

const { FIO_NFT_POLYGON_CONTRACT, oracleCache } = config || {};

class PolyCtrl {
    constructor() {
        this.web3 = new Web3(process.env.POLYGON_INFURA);
        this.fioNftContract = new this.web3.eth.Contract(fioNftABI, FIO_NFT_POLYGON_CONTRACT);
    }
    async getGasPriceAndGasLimit({ logPrefix }) {
        const gasPriceSuggestion = await getPolygonGasPriceSuggestion();

        const isUsingGasApi = !!parseInt(process.env.USEGASAPI);

        let gasPrice = 0;

        if ((isUsingGasApi && gasPriceSuggestion) || (!isUsingGasApi && parseInt(process.env.PGASPRICE) <= 0)) {
            console.log(logPrefix + 'using gasPrice value from the api:');
            if (process.env.GASPRICELEVEL === "average") {
                gasPrice = calculateAverageGasPrice(gasPriceSuggestion);
            } else if(process.env.GASPRICELEVEL === "low") {
                gasPrice = gasPriceSuggestion;
            } else if(process.env.GASPRICELEVEL === "high") {
                gasPrice = calculateHighGasPrice(gasPriceSuggestion);
            }
        } else if (!isUsingGasApi || (isUsingGasApi && gasPriceSuggestion)){
            console.log(logPrefix + 'using gasPrice value from the .env:');
            gasPrice = convertGweiToWei(process.env.PGASPRICE);
        }

        if (!gasPrice) throw new Error(logPrefix + 'Cannot set valid Gas Price value');

        const gasLimit = parseFloat(process.env.PGASLIMIT);

        console.log(logPrefix + `gasPrice = ${gasPrice} (${convertWeiToGwei(gasPrice)} GWEI), gasLimit = ${gasLimit}`);

        return { gasLimit, gasPrice };
    }

    async getBalance({ logPrefix}) {
        this.web3.eth.getBalance(process.env.POLYGON_ORACLE_PUBLIC, 'latest', (error, oracleBalance) => {
                if (error) {
                    console.log(logPrefix + error.stack)
                } else {
                    if (convertWeiToEth(oracleBalance) < ((convertWeiToEth(gasLimit * gasPrice)) * 5)) {
                        const timeStamp = new Date().toISOString();
                        console.log(logPrefix + `Warning: Low Oracle Polygon Address Balance: ${convertWeiToEth(oracleBalance)} MATIC`)
                        fs.writeFileSync(LOG_FILES_PATH_NAMES.oracleErrors, timeStamp + ' ' + logPrefix + `Warning: Low Oracle Polygon Address Balance: ${convertWeiToEth(oracleBalance)} MATIC`)
                    }
                }
            })
    }

    async wrapFioDomain() { // execute wrap action
        if (!oracleCache.get(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting))
            oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, true, 0);

        const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue).toString().split('\r\n')[0];
        if (transactionToProceed === '') {
            oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
            return;
        }

        const txIdOnFioChain = transactionToProceed.split(' ')[0];
        const wrapData = JSON.parse(transactionToProceed.split(' ')[1]);

        const logPrefix = `MATIC, wrapFioDomain, FIO tx_id: ${txIdOnFioChain}, domain: "${wrapData.fio_domain}", public_address: "${wrapData.public_address}": --> `
        console.log(logPrefix + 'Executing wrapFioDomain.');

        try {
            const domainName = wrapData.fio_domain;
            const common = handlePolygonChainCommon();

            const { gasLimit, gasPrice } = await this.getGasPriceAndGasLimit({ logPrefix });

            // we shouldn't await it to do not block the rest of the actions
            this.getBalance({ logPrefix });

            const isOracleAddressValid = await isOraclePolygonAddressValid();

            if (isOracleAddressValid) {
                let isTransactionProceededSuccessfully = false;
                try {
                    const pubKey = process.env.POLYGON_ORACLE_PUBLIC;
                    const signKey = process.env.POLYGON_ORACLE_PRIVATE;

                    //Commented this out. It was throwing an uncaught exception.
                    // todo: check if we should make wrap call (maybe just jump to read logs file) in case of already approved transaction by current oracle (do not forget to await)
                    //this.fioNftContract.methods.getApproval(txIdOnFioChain).call()
                    //    .then((response) => {
                    //        console.log(logPrefix + 'Oracles Approvals:');
                    //        console.log(response);
                    //    });

                    if (this.web3.utils.isAddress(wrapData.public_address) === true && wrapData.chain_code === "MATIC") { //check validation if the address is ERC20 address
                        console.log(logPrefix + `requesting wrap domain action for ${domainName} FIO domain to ${wrapData.public_address}`)
                        const wrapDomainFunction = this.fioNftContract.methods.wrapnft(wrapData.public_address, wrapData.fio_domain, txIdOnFioChain);
                        let wrapABI = wrapDomainFunction.encodeABI();

                        const chainNonce = await this.web3.eth.getTransactionCount(pubKey, 'pending');
                        const txNonce = handlePolygonNonceValue({ chainNonce });

                        addLogMessage({
                            filePath: LOG_FILES_PATH_NAMES.MATIC,
                            message: `Polygon fio.erc721 wrapdomain submit { gasPrice: ${gasPrice}, gasLimit: ${gasLimit}, domain: ${wrapData.fio_domain}, to: ${process.env.FIO_NFT_POLYGON_CONTRACT}, from: ${pubKey}, nonce: ${txNonce}}`,
                        });

                        const onSussessTransaction = (receipt) => {
                            addLogMessage({
                                filePath: LOG_FILES_PATH_NAMES.MATIC,
                                message: `Polygon fio.erc721 wrapdomain ${JSON.stringify(receipt)}`,
                            });

                            isTransactionProceededSuccessfully = true;
                        };
                        
                        await polygonTransaction({
                          common,
                          contract: FIO_NFT_POLYGON_CONTRACT,
                          data: wrapABI,
                          gasPrice,
                          gasLimit,
                          handleSuccessedResult: onSussessTransaction,
                          logPrefix,
                          oraclePrivateKey: signKey,
                          oraclePublicKey: pubKey,
                          shouldThrowError: true,
                          txNonce,
                          updateNonce: updatePolygonNonce,
                          web3Instanstce: this.web3,
                        });
                    } else {
                        console.log(logPrefix + "Invalid Address");
                    }
                } catch (error) {
                    handleChainError({
                        logMessage: `Polygon fio.erc721 wrapdomain ${error}`,
                        consoleMessage: logPrefix + error.stack
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedWrapItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue,
                        txId: txIdOnFioChain,
                        wrapData
                    })
                }

                handleUpdatePendingPolygonItemsQueue({
                    action: this.wrapFioDomain.bind(this),
                    logPrefix,
                    logFilePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
                    jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting
                })
                console.log(logPrefix + 'Oracle data is not valid, pls check .env and contract abi.')
            } else oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);
        } catch (err) {
            oracleCache.set(ORACLE_CACHE_KEYS.isWrapOnPolygonJobExecuting, false, 0);

            handleServerError(err, 'Polygon, wrapFioDomain')
        }
    }

    async burnNFTOnPolygon() {
        if (!oracleCache.get(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting))
            oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, true, 0);

        const transactionToProceed = fs.readFileSync(LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue).toString().split('\r\n')[0];
        if (transactionToProceed === '') {
            oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
            return;
        }

        const burnNFTData = JSON.parse(transactionToProceed);

        const { tokenId, obtId, domainName } = burnNFTData || {};

        const logPrefix = `MATIC, burnNFT, FIO obtId: ${obtId}, domain: "${domainName}", tokenId: "${tokenId}": --> `;
        console.log(logPrefix + 'Executing burnNFT.');

        try {
            const common = handlePolygonChainCommon();
            const { gasLimit, gasPrice } = await this.getGasPriceAndGasLimit({ logPrefix });

            // we shouldn't await it to do not block the rest of the actions
            this.getBalance({ logPrefix });

            const isOracleAddressValid = await isOraclePolygonAddressValid();

            if (isOracleAddressValid) {
                let isTransactionProceededSuccessfully = false;

                try {
                    const oraclePublicKey = process.env.POLYGON_ORACLE_PUBLIC;
                    const oraclePrivateKey = process.env.POLYGON_ORACLE_PRIVATE;

                    const burnNFTFunction = fioNftPolygonContract.methods.burnnft(
                        tokenId,
                        obtId
                    );
                    let burnABI = burnNFTFunction.encodeABI();

                    const chainNonce = await this.web3.eth.getTransactionCount(
                        oraclePublicKey,
                        'pending'
                    );

                    const txNonce = handlePolygonNonceValue({ chainNonce });

                    addLogMessage({
                      filePath: LOG_FILES_PATH_NAMES.MATIC,
                      message: `Polygon fio.erc721 burnNFT submit { gasPrice: ${gasPrice}, gasLimit: ${gasLimit}, domain: ${domainName}, to: ${process.env.FIO_NFT_POLYGON_CONTRACT}, from: ${oraclePublicKey}, nonce: ${txNonce}}`,
                    });

                    const onSussessTransaction = (receipt) => {
                      addLogMessage({
                        filePath: LOG_FILES_PATH_NAMES.MATIC,
                        message: `Polygon fio.erc721 burnNFT ${JSON.stringify(
                          receipt
                        )}`,
                      });

                      isTransactionProceededSuccessfully = true;
                    };

                    await polygonTransaction({
                        common,
                        contract: FIO_NFT_POLYGON_CONTRACT,
                        data: burnABI,
                        gasPrice,
                        gasLimit,
                        handleSuccessedResult: onSussessTransaction,
                        logPrefix,
                        oraclePrivateKey,
                        oraclePublicKey,
                        shouldThrowError: true,
                        txNonce,
                        updateNonce: updatePolygonNonce,
                        web3Instanstce: this.web3,
                    });
                } catch (error) {
                    handleChainError({
                        logMessage: `Polygon fio.erc721 burnNFT ${error}`,
                        consoleMessage: logPrefix + error.stack,
                    });
                }

                if (!isTransactionProceededSuccessfully) {
                    handleLogFailedBurnNFTItem({
                        logPrefix,
                        errorLogFilePath: LOG_FILES_PATH_NAMES.burnNFTErroredTransactions,
                        burnData: burnNFTData,
                    });
                }

                handleUpdatePendingPolygonItemsQueue({
                  action: this.burnNFTOnPolygon.bind(this),
                  logPrefix,
                  logFilePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
                  jobIsRunningCacheKey: ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting,
                });
            } else {
                oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);
            }
        } catch (error) {
            oracleCache.set(ORACLE_CACHE_KEYS.isBurnNFTOnPolygonJobExecuting, false, 0);

            handleServerError(err, 'Polygon, burnNft')
        }
    }
}

export default new PolyCtrl();
