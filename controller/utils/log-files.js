import fs from 'fs';

import config from '../../config/config.js';
import { LOG_FILES_PATH_NAMES, LOG_DIRECTORY_PATH_NAME } from '../constants/log-files.js';

import { replaceNewLines } from '../utils/general.js';

const { oracleCache } = config;

export const createLogFile = ({ filePath, dataToWrite, showSuccessConsole }) => {
  fs.writeFileSync(filePath, dataToWrite, (err) => {
    //create new file
    if (err) {
      return console.log(err);
    }

    if (showSuccessConsole) console.log(`The file ${filePath} was saved!`);
  });
};

export const prepareLogDirectory = (directoryPath, withLogsInConsole = true) => {
  if (fs.existsSync(directoryPath)) {
    //check if the log path exists
    if (withLogsInConsole) console.log('The log directory exists.');
  } else {
    if (withLogsInConsole) console.log('The log directory does not exist.');
    fs.mkdir(directoryPath, (err) => {
      //create new file
      if (err) {
        return console.log(err);
      }
      if (withLogsInConsole) console.log('The log directory was created!');
    });
  }
};

export const prepareLogFile = async (
  { filePath, fetchLastBlockNumber = null, offset = null },
  withLogsInConsole = true,
) => {
  if (fs.existsSync(filePath)) {
    //check file exist
    if (withLogsInConsole) console.log(`The file ${filePath} exists.`);
    if (fetchLastBlockNumber) {
      const lastProcessedBlockNumber = fs.readFileSync(filePath, 'utf8');

      if (!lastProcessedBlockNumber) {
        let lastBlockNumberInChain;
        if (fetchLastBlockNumber) {
          const blocksOffset = parseInt(offset) || 0;
          lastBlockNumberInChain = (await fetchLastBlockNumber()) - blocksOffset;
        }
        createLogFile({
          filePath,
          dataToWrite: lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '',
          showSuccessConsole: withLogsInConsole,
        });
      }
    }
  } else {
    if (withLogsInConsole) console.log(`The file ${filePath} does not exist.`);
    let lastBlockNumberInChain;
    if (fetchLastBlockNumber) {
      const blocksOffset = parseInt(offset) || 0;
      lastBlockNumberInChain = (await fetchLastBlockNumber()) - blocksOffset;
    }
    createLogFile({
      filePath,
      dataToWrite: lastBlockNumberInChain ? lastBlockNumberInChain.toString() : '',
      showSuccessConsole: withLogsInConsole,
    });
  }
};

export const addLogMessage = ({
  filePath,
  timestampTitle = '',
  addTimestamp = true,
  message,
}) => {
  const isJsonFormat = typeof message === 'object';
  const timeStamp = new Date().toISOString();

  if (isJsonFormat) {
    if (addTimestamp)
      message[timestampTitle && timestampTitle.length ? timestampTitle : 'timeStamp'] =
        timeStamp;
    fs.appendFileSync(filePath, JSON.stringify(message) + '\r\n');
  } else {
    fs.appendFileSync(
      filePath,
      (addTimestamp ? timestampTitle + timeStamp + ' ' : '') + message + '\r\n',
    );
  }
};

export const updatefioOraclePositionFIO = (accountActionSequence) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.fioOraclePosition, accountActionSequence);
};

export const updatefioAddressPositionFIO = (accountActionSequence) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.fioAddressPosition, accountActionSequence);
};

export const updateBlockNumberFIO = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, blockNumber);
};

export const updateBlockNumberFIOForBurnNFT = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT, blockNumber);
};

export const updateBlockNumberForTokensUnwrappingOnETH = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH, blockNumber);
};

export const updateBlockNumberForDomainsUnwrappingOnETH = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH, blockNumber);
};

export const updateBlockNumberMATIC = (blockNumber) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon, blockNumber);
};

export const updateEthNonce = (nonce) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.ethNonce, nonce ? nonce.toString() : '');
};

export const updatePolygonNonce = (nonce) => {
  fs.writeFileSync(LOG_FILES_PATH_NAMES.polygonNonce, nonce ? nonce.toString() : '');
};

export const getLastProceededBlockNumberOnFioChain = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberFIO, 'utf8'));
};

export const getLastProceededBlockNumberOnFioChainForBurnNFT = () => {
  return parseFloat(
    fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberFIOForBurnNFT, 'utf8'),
  );
};

export const getLastProceededFioOraclePositionFioChain = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.fioOraclePosition));
};

export const getLastProceededFioAddressPositionFioChain = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.fioAddressPosition, 'utf-8'));
};

export const getLastProceededBlockNumberOnEthereumChainForTokensUnwrapping = () => {
  return parseFloat(
    fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapTokensETH, 'utf8'),
  );
};

export const getLastProceededBlockNumberOnEthereumChainForDomainUnwrapping = () => {
  return parseFloat(
    fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainETH, 'utf8'),
  );
};

export const getLastProceededBlockNumberOnPolygonChainForDomainUnwrapping = () => {
  return parseFloat(
    fs.readFileSync(LOG_FILES_PATH_NAMES.blockNumberUnwrapDomainPolygon, 'utf8'),
  );
};

export const getLastProceededEthNonce = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.ethNonce, 'utf8'));
};

export const getLastProceededPolygonNonce = () => {
  return parseFloat(fs.readFileSync(LOG_FILES_PATH_NAMES.polygonNonce, 'utf8'));
};

export const handleLogFailedWrapItem = ({
  logPrefix,
  txId,
  wrapData,
  errorLogFilePath,
}) => {
  console.log(
    logPrefix +
      `Something went wrong with the current wrapping action. Storing transaction data into ${errorLogFilePath}`,
  );
  const wrapText = txId + ' ' + JSON.stringify(wrapData) + '\r\n';
  fs.appendFileSync(errorLogFilePath, wrapText); // store issued transaction to errored log file queue by line-break
};

export const handleLogFailedBurnNFTItem = ({ logPrefix, burnData, errorLogFilePath }) => {
  console.log(
    logPrefix +
      `Something went wrong with the current burnNFT action. Storing transaction data into ${errorLogFilePath}`,
  );
  const burnText = burnData + '\r\n';
  fs.appendFileSync(errorLogFilePath, burnText); // store issued transaction to errored log file queue by line-break
};

export const handlePolygonNonceValue = ({ chainNonce }) => {
  let txNonce = chainNonce;
  const savedNonce = getLastProceededPolygonNonce();

  if (savedNonce && Number(savedNonce) === Number(chainNonce)) {
    txNonce = txNonce++;
  }

  updatePolygonNonce(txNonce);

  return txNonce;
};

export const handleEthNonceValue = ({ chainNonce }) => {
  let txNonce = chainNonce;
  const savedNonce = getLastProceededEthNonce();

  if (savedNonce && Number(savedNonce) === Number(chainNonce)) {
    txNonce = txNonce++;
  }

  updateEthNonce(txNonce);

  return txNonce;
};

export const handleUpdatePendingPolygonItemsQueue = ({
  action,
  logFilePath,
  logPrefix,
  jobIsRunningCacheKey,
}) => {
  const csvContent = fs.readFileSync(logFilePath).toString().split('\r\n'); // read file and convert to array by line break
  csvContent.shift(); // remove the first element from array

  if (csvContent.length > 0 && csvContent[0] !== '') {
    const newLogFileDataToSave = csvContent.join('\r\n'); // convert array back to string
    fs.writeFileSync(logFilePath, newLogFileDataToSave);
    console.log(logPrefix + `${logFilePath} log file was successfully updated.`);
    action();
  } else {
    console.log(logPrefix + `${logFilePath} log file was successfully updated.`);
    fs.writeFileSync(logFilePath, '');
    oracleCache.set(jobIsRunningCacheKey, false, 0);
  }
};

// function to handle all unexpected request errors (like bad internet connection or invalid response) and add them into Error.log file
export const handleServerError = async (err, additionalMessage = null) => {
  if (additionalMessage) console.log(additionalMessage + ': ');
  console.log(err.stack);

  prepareLogDirectory(LOG_DIRECTORY_PATH_NAME, false);
  await prepareLogFile({ filePath: LOG_FILES_PATH_NAMES.oracleErrors }, false);

  addLogMessage({
    filePath: LOG_FILES_PATH_NAMES.oracleErrors,
    message: replaceNewLines(
      (additionalMessage ? additionalMessage + ': ' : '') + err.stack,
    ),
  });
};

// function to handle all unexpected chains transactions errors and add them into Error.log file
export const handleChainError = ({ logMessage, consoleMessage }) => {
  console.log(consoleMessage);
  addLogMessage({
    filePath: LOG_FILES_PATH_NAMES.oracleErrors,
    message: replaceNewLines(logMessage),
  });
};

export const getLatestEthNonce = () => {
  const filePath = LOG_FILES_PATH_NAMES.ethNonce;
  if (!fs.existsSync(filePath)) {
    createLogFile({
      filePath,
      dataToWrite: '0',
      showSuccessConsole: true,
    });
  }
};

export const getLatestPolygonNonce = () => {
  const filePath = LOG_FILES_PATH_NAMES.polygonNonce;
  if (!fs.existsSync(filePath)) {
    createLogFile({
      filePath,
      dataToWrite: '0',
      showSuccessConsole: true,
    });
  }
};
