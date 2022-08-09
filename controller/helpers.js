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
    blockName = null,
    fetchLastBlockNumber = null,
}, withLogsInConsole = true) => {
    if (fs.existsSync(filePath)) { //check file exist
        if (withLogsInConsole) console.log(`The file ${filePath} exists.`);
        if (blockName) {
            // todo: this could be improved to compare: lastBlockNumberInChain - lastProcessedBlockNumber <= InfuraApiPlanLimitation (or whatever else limitation value),
            //  and set proper value to cache. InfuraApiPlanLimitation could be managed by .env
            // const lastProcessedBlockNumber = fs.readFileSync(filePath, 'utf8');
            // config.oracleCache.set( blockName, parseInt(lastProcessedBlockNumber), 10000 );

            // permanent fix (always use the latest block from the chain), to avoid BD-3541 (Blockheight too far in the past error)
            let lastBlockNumberInChain;
            if (fetchLastBlockNumber) lastBlockNumberInChain = await fetchLastBlockNumber();
            fs.writeFileSync(filePath, lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '', (err) => { //create new file
                if (err) {
                    return console.log(err);
                }
                if (withLogsInConsole) console.log(`The file ${filePath} was saved!`);
            });
            config.oracleCache.set(blockName, lastBlockNumberInChain, 10000)
        }
    } else {
        if (withLogsInConsole) console.log(`The file ${filePath} does not exist.`);
        let lastBlockNumberInChain;
        if (fetchLastBlockNumber && blockName) lastBlockNumberInChain = await fetchLastBlockNumber();
        fs.writeFileSync(filePath, lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '', (err) => { //create new file
            if (err) {
                return console.log(err);
            }
            if (withLogsInConsole) console.log(`The file ${filePath} was saved!`);
        });
        if (blockName && lastBlockNumberInChain) config.oracleCache.set(blockName, lastBlockNumberInChain, 10000);
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
    return parseFloat(Web3.utils.fromWei(weiValue, 'gwei'))
}

export const convertGweiToWei = (gweiValue) => {
    return parseFloat(Web3.utils.toWei(gweiValue, 'gwei'));
}

export const convertWeiToEth = (weiValue) => {
    return parseFloat(Web3.utils.fromWei(weiValue, "ether"));
}

