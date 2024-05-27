import fs from 'fs';
import Web3 from 'web3';


import {
    LOG_FILES_PATH_NAMES,
    LOG_DIRECTORY_PATH_NAME,
} from './constants.js';
import fioABI from '../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../config/ABI/FIONFT.json' assert { type: 'json' };
import fioMaticNftABI from '../config/ABI/FIOMATICNFT.json' assert { type: 'json' };
import config from '../config/config.js';

const replaceNewLines = (stringValue, replaceChar = ', ') => {
    return  stringValue.replace(/(?:\r\n|\r|\n)/g, replaceChar);
}

// function to handle all unexpected request errors (like bad internet connection or invalid response) and add them into Error.log file
const handleServerError = async (err, additionalMessage = null) => {
    if (additionalMessage) console.log(additionalMessage+ ': ')
    console.log(err.stack)

    prepareLogDirectory(LOG_DIRECTORY_PATH_NAME, false);
    await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.oracleErrors }, false);

    addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.oracleErrors,
        message: replaceNewLines((additionalMessage ?  (additionalMessage + ': ') : '') + err.stack),
    });
}

// function to handle all unexpected chains transactions errors and add them into Error.log file
const handleChainError = ({logMessage, consoleMessage}) => {
    console.log(consoleMessage);
    addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.oracleErrors,
        message: replaceNewLines(logMessage),
    });
}

const createLogFile = ({ filePath, dataToWrite, showSuccessConsole }) => {
    fs.writeFileSync(
        filePath,
        dataToWrite,
        (err) => {
            //create new file
            if (err) {
                return console.log(err);
            }
    
            if (showSuccessConsole)
              console.log(`The file ${filePath} was saved!`);
        }
)};

const prepareLogDirectory = (directoryPath, withLogsInConsole = true) => {
    if (fs.existsSync(directoryPath)) { //check if the log path exists
        if (withLogsInConsole) console.log("The log directory exists.");
    } else {
        if (withLogsInConsole) console.log('The log directory does not exist.');
        fs.mkdir(directoryPath, (err) => { //create new file
            if(err) {
                return console.log(err);
            }
            if (withLogsInConsole) console.log("The log directory was created!");
        });
    }
}

const prepareLogFile = async ({
    filePath,
    fetchLastBlockNumber = null,
    offset = null,
}, withLogsInConsole = true) => {
    if (fs.existsSync(filePath)) { //check file exist
        if (withLogsInConsole) console.log(`The file ${filePath} exists.`);
        if (fetchLastBlockNumber) {
            const lastProcessedBlockNumber = fs.readFileSync(filePath, 'utf8');

            if (!lastProcessedBlockNumber) {
                let lastBlockNumberInChain;
                if (fetchLastBlockNumber) {
                    const blocksOffset = parseInt(offset) || 0;
                    lastBlockNumberInChain = await fetchLastBlockNumber() - blocksOffset;
                }
                createLogFile({
                  filePath,
                  dataToWrite: lastBlockNumberInChain
                    ? lastBlockNumberInChain.toString()
                    : '',
                  showSuccessConsole: withLogsInConsole,
                });
            }
        }
    } else {
        if (withLogsInConsole) console.log(`The file ${filePath} does not exist.`);
        let lastBlockNumberInChain;
        if (fetchLastBlockNumber) {
            const blocksOffset = parseInt(offset) || 0;
            lastBlockNumberInChain = await fetchLastBlockNumber() - blocksOffset;
        }
        createLogFile({
          filePath,
          dataToWrite: lastBlockNumberInChain
            ? lastBlockNumberInChain.toString()
            : '',
          showSuccessConsole: withLogsInConsole,
        });
    }
}

const addLogMessage = ({
    filePath,
    timestampTitle = '',
    addTimestamp = true,
    message,
}) => {
    const isJsonFormat = typeof message === 'object';
    const timeStamp = new Date().toISOString();

    if (isJsonFormat) {
        if (addTimestamp) message[(timestampTitle && timestampTitle.length) ? timestampTitle : 'timeStamp'] = timeStamp
        fs.appendFileSync(filePath, JSON.stringify(message) +'\r\n')
    } else {
        fs.appendFileSync(filePath, (addTimestamp ? (timestampTitle + timeStamp + ' ') : '') + message +'\r\n');
    }
}

const updateBlockNumberFIO = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, blockNumber);
}
const updateBlockNumberFIOForBurnNFT = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT, blockNumber);
};
const updateBlockNumberForTokensUnwrappingOnETH = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH, blockNumber);
}
const updateBlockNumberForDomainsUnwrappingOnETH = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH, blockNumber);
}
const updateBlockNumberMATIC = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon, blockNumber);
}
const updateEthNonce = (nonce) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.ethNonce, nonce ? nonce.toString() : '');
}
const updatePolygonNonce = (nonce) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.polygonNonce, nonce ? nonce.toString() : '');
};

const getLastProceededBlockNumberOnFioChain = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, 'utf8'));
}
const getLastProceededBlockNumberOnFioChainForBurnNFT = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT, 'utf8'));
} 
const getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH, 'utf8'));
}
const getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH, 'utf8'));
}
const getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon, 'utf8'));
}
const getLastProceededEthNonce = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.ethNonce, 'utf8'));
}
const getLastProceededPolygonNonce = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.polygonNonce, 'utf8'));
};

const convertNativeFioIntoFio = (nativeFioValue) => {
    const fioDecimals = 1000000000;
    return parseInt(nativeFioValue + '') / fioDecimals;
}

const checkHttpResponseStatus = async (response, additionalErrorMessage = null) => {
    if (response.ok) {
        // response.status >= 200 && response.status < 300
        return response;
    } else {
        if (additionalErrorMessage) console.log(additionalErrorMessage)
        const errorBody = await response.text();
        throw new Error(errorBody);
    }
}

const handleUpdatePendingPolygonItemsQueue = ({
    action,
    logFilePath,
    logPrefix,
    jobIsRunningCacheKey,
}) => {
    let csvContent = fs.readFileSync(logFilePath).toString().split('\r\n'); // read file and convert to array by line break
    csvContent.shift(); // remove the first element from array

    if (csvContent.length > 0 && csvContent[0] !== '') {
        const newLogFileDataToSave = csvContent.join('\r\n'); // convert array back to string
        fs.writeFileSync(logFilePath, newLogFileDataToSave);
        console.log(logPrefix + `${logFilePath} log file was successfully updated.`);
        action();
    } else {
        console.log(logPrefix + `${logFilePath} log file was successfully updated.`);
        fs.writeFileSync(logFilePath, "");
        config.oracleCache.set(jobIsRunningCacheKey, false, 0);
    }
}

const handleLogFailedWrapItem = ({
    logPrefix,
    txId,
    wrapData,
    errorLogFilePath,
}) => {
    console.log(logPrefix + `Something went wrong with the current wrapping action. Storing transaction data into ${errorLogFilePath}`)
    const wrapText = txId + ' ' + JSON.stringify(wrapData) + '\r\n';
    fs.appendFileSync(errorLogFilePath, wrapText) // store issued transaction to errored log file queue by line-break
}

const handleLogFailedBurnNFTItem = ({
    logPrefix,
    burnData,
    errorLogFilePath,
}) => {
    console.log(
        logPrefix +
        `Something went wrong with the current burnNFT action. Storing transaction data into ${errorLogFilePath}`
    );
    const burnText = burnData + '\r\n';
    fs.appendFileSync(errorLogFilePath, burnText); // store issued transaction to errored log file queue by line-break
};

const isOracleEthAddressValid = async (isTokens = true) => {
    const web3 = new Web3(process.env.ETHINFURA);
    const contract = new web3.eth.Contract(isTokens ? fioABI : fioNftABI, isTokens ? process.env.FIO_TOKEN_ETH_CONTRACT : process.env.FIO_NFT_ETH_CONTRACT);

    const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

    return !!(registeredOraclesPublicKeys.map(registeredOracle => registeredOracle.toLowerCase()).includes(process.env.ETH_ORACLE_PUBLIC.toLowerCase()))
}

const isOraclePolygonAddressValid = async () => {
    const web3 = new Web3(process.env.POLYGON_INFURA);
    const contract = new web3.eth.Contract(fioMaticNftABI, process.env.FIO_NFT_POLYGON_CONTRACT);

    const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

    return !!(registeredOraclesPublicKeys.map(registeredOracle => registeredOracle.toLowerCase()).includes(process.env.POLYGON_ORACLE_PUBLIC.toLowerCase()))
}

const checkEthBlockNumbers = async () => {
    const web3 = new Web3(process.env.ETHINFURA);
    const promise1 = new Promise(async (resolve) => {
        resolve(await web3.eth.getBlockNumber());
    })
    const promise2 = new Promise(async (resolve) => {
        resolve((await web3.eth.getBlock('latest')).number);
    })
    const promise3 = new Promise(async (resolve) => {
        resolve((await web3.eth.getBlock('pending')).number);
    })

    const res = await Promise.all([promise1, promise2, promise3])
    console.log(JSON.stringify(res))
}

const handleBackups = async (callback, isRetry, backupParams) => {
    try {
        if (isRetry && backupParams) return await callback(backupParams);
        return await callback();
    } catch (error) {
        if (backupParams && !isRetry) {
          return await handleBackups(callback, true, backupParams);
        } else {
          throw error;
        }
    }
};

const handlePolygonNonceValue = ({ chainNonce }) => {
    let txNonce = chainNonce;
    const savedNonce = getLastProceededPolygonNonce();

    if (savedNonce && Number(savedNonce) === Number(chainNonce)) {
      txNonce = txNonce++;
    }

    updatePolygonNonce(txNonce);

    return txNonce;
};

const handleEthNonceValue = ({ chainNonce }) => {
  let txNonce = chainNonce;
  const savedNonce = getLastProceededEthNonce();

  if (savedNonce && Number(savedNonce) === Number(chainNonce)) {
    txNonce = txNonce++;
  }

  updateEthNonce(txNonce);

  return txNonce;
};

export {
  createLogFile,
  isOraclePolygonAddressValid,
  isOracleEthAddressValid,
  handleLogFailedWrapItem,
  handleLogFailedBurnNFTItem,
  handleUpdatePendingPolygonItemsQueue,
  handleEthNonceValue,
  handlePolygonNonceValue,
  checkHttpResponseStatus,
  convertNativeFioIntoFio,
  getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping,
  getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping,
  getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping,
  getLastProceededBlockNumberOnFioChain,
  updateBlockNumberMATIC,
  updateBlockNumberForDomainsUnwrappingOnETH,
  updateBlockNumberForTokensUnwrappingOnETH,
  updateBlockNumberFIO,
  addLogMessage,
  prepareLogFile,
  prepareLogDirectory,
  handleChainError,
  handleServerError,
  replaceNewLines,
  checkEthBlockNumbers,
  handleBackups,
  updateEthNonce,
  updatePolygonNonce,
  updateBlockNumberFIOForBurnNFT,
  getLastProceededBlockNumberOnFioChainForBurnNFT,
};
