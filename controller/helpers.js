import fs from "fs";
import Web3 from 'web3';
import config from "../config/config";
import {LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME} from "./constants";

// function to handle all unexpected request errors (like bad internet connection or invalid response) and add them into Error.log file
export const handleServerError = async (err, additionalMessage = null) => {
    if (additionalMessage) console.log(additionalMessage+ ': ')
    console.log(err.stack)

    prepareLogDirectory(LOG_DIRECTORY_PATH_NAME, false);
    await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.oracleErrors }, false);

    addLogMessage({
        filePath: LOG_FILES_PATH_NAMES.oracleErrors,
        message: (additionalMessage ?  (additionalMessage + ': ') : '') + err.stack,
    });
}

export const prepareLogDirectory = (directoryPath, withLogsInConsole = true) => {
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

export const prepareLogFile = async ({
    filePath,
    fetchLastBlockNumber = null,
}, withLogsInConsole = true) => {
    if (fs.existsSync(filePath)) { //check file exist
        if (withLogsInConsole) console.log(`The file ${filePath} exists.`);
        if (fetchLastBlockNumber) {
            const lastProcessedBlockNumber = fs.readFileSync(filePath, 'utf8');

            if (!lastProcessedBlockNumber) {
                let lastBlockNumberInChain;
                if (fetchLastBlockNumber) lastBlockNumberInChain = await fetchLastBlockNumber();
                fs.writeFileSync(filePath, lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '', (err) => { //create new file
                    if (err) {
                        return console.log(err);
                    }
                    if (withLogsInConsole) console.log(`The file ${filePath} was saved!`);
                });
            }
        }
    } else {
        if (withLogsInConsole) console.log(`The file ${filePath} does not exist.`);
        let lastBlockNumberInChain;
        if (fetchLastBlockNumber) lastBlockNumberInChain = await fetchLastBlockNumber();
        fs.writeFileSync(filePath, lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '', (err) => { //create new file
            if (err) {
                return console.log(err);
            }
            if (withLogsInConsole) console.log(`The file ${filePath} was saved!`);
        });
    }
}

export const addLogMessage = ({
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

export const convertWeiToGwei = (weiValue) => {
    return parseFloat(Web3.utils.fromWei(typeof weiValue === 'number' ? weiValue + '': weiValue, 'gwei'))
}

export const convertGweiToWei = (gweiValue) => {
    return parseFloat(Web3.utils.toWei(gweiValue, 'gwei'));
}

export const convertWeiToEth = (weiValue) => {
    return parseFloat(Web3.utils.fromWei(typeof weiValue === 'number' ? weiValue + '': weiValue, "ether"));
}

export const updateBlockNumberFIO = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, blockNumber);
}
export const updateBlockNumberETH = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberETH, blockNumber);
}
export const updateBlockNumberMATIC = (blockNumber) => {
    fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberMATIC, blockNumber);
}

export const getLastProceededBlockNumberOnFioChain = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, 'utf8'));
}
export const getLastProceededBlockNumberOnEthereumChain = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberETH, 'utf8'));
}
export const getLastProceededBlockNumberOnPolygonChain = () => {
    return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberMATIC, 'utf8'));
}

export const convertNativeFioIntoFio = (nativeFioValue) => {
    const fioDecimals = 1000000000;
    return parseInt(nativeFioValue + '') / fioDecimals;
}

