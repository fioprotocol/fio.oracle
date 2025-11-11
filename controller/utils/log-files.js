import fs from 'fs';

import {
  LOG_FILES_KEYS,
  getLogFilePath,
  LOG_DIRECTORY_PATH_NAME,
} from './log-file-templates.js';
import config from '../../config/config.js';
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
  { filePath, fetchAction = null, offset = null },
  withLogsInConsole = true,
) => {
  if (fs.existsSync(filePath)) {
    //check file exist
    if (withLogsInConsole) console.log(`The file ${filePath} exists.`);
    if (fetchAction) {
      const lastProcessedBlockNumber = fs.readFileSync(filePath, 'utf8');

      if (!lastProcessedBlockNumber) {
        let lastBlockNumberInChain;
        if (fetchAction) {
          const blocksOffset = parseInt(offset) || 0;
          const chainBlockNumber = await fetchAction();

          lastBlockNumberInChain =
            typeof chainBlockNumber === 'bigint'
              ? parseFloat(chainBlockNumber)
              : chainBlockNumber - blocksOffset;
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
    if (fetchAction) {
      const blocksOffset = parseInt(offset) || 0;
      const chainBlockNumber = await fetchAction();

      lastBlockNumberInChain =
        typeof chainBlockNumber === 'bigint'
          ? parseFloat(chainBlockNumber)
          : chainBlockNumber - blocksOffset;
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

export const readLogFile = (filePath) => fs.readFileSync(filePath, 'utf8');

export const updateFioOracleId = (oracleId) => {
  fs.writeFileSync(getLogFilePath({ key: LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID }), oracleId);
};

export const updateNonce = ({ chainCode, nonce }) => {
  fs.writeFileSync(
    getLogFilePath({ key: LOG_FILES_KEYS.NONCE, chainCode }),
    nonce ? nonce.toString() : '',
  );
};

export const getLastProcessedFioOracleItemId = () => {
  return parseFloat(
    fs.readFileSync(getLogFilePath({ key: LOG_FILES_KEYS.FIO_ORACLE_ITEM_ID }), 'utf-8'),
  );
};

export const updateBlockNumber = ({ chainCode, blockNumber }) => {
  fs.writeFileSync(
    getLogFilePath({ key: LOG_FILES_KEYS.BLOCK_NUMBER, chainCode }),
    blockNumber,
  );
};

export const getLastProcessedBlockNumber = ({ chainCode }) => {
  return parseFloat(
    fs.readFileSync(
      getLogFilePath({ key: LOG_FILES_KEYS.BLOCK_NUMBER, chainCode }),
      'utf8',
    ),
  );
};

export const handleLogFailedWrapItem = ({
  logPrefix,
  txId,
  wrapData,
  errorLogFilePath,
}) => {
  console.log(
    `${logPrefix} Something went wrong with the current wrapping action. Storing transaction data into ${errorLogFilePath}`,
  );
  const wrapText = txId + ' ' + JSON.stringify(wrapData) + '\r\n';
  fs.appendFileSync(errorLogFilePath, wrapText); // store issued transaction to errored log file queue by line-break
};

export const handleLogFailedBurnNFTItem = ({ logPrefix, burnData, errorLogFilePath }) => {
  console.log(
    `${logPrefix} Something went wrong with the current burnNFT action. Storing transaction data into ${errorLogFilePath}`,
  );
  const burnText = burnData + '\r\n';
  fs.appendFileSync(errorLogFilePath, burnText); // store issued transaction to errored log file queue by line-break
};

export const handleLogFailedUnwrapItem = ({
  logPrefix,
  txId,
  unwrapData,
  errorLogFilePath,
}) => {
  console.log(
    `${logPrefix} Something went wrong with the current unwrap action. Storing transaction data into ${errorLogFilePath}`,
  );
  const unwrapText = txId + ' ' + JSON.stringify(unwrapData) + '\r\n';
  fs.appendFileSync(errorLogFilePath, unwrapText); // store issued transaction to errored log file queue by line-break
};

export const handleNonceValue = ({ chainNonce, chainCode }) => {
  let txNonce = typeof chainNonce === 'bigint' ? parseInt(chainNonce) : chainNonce;

  const savedNonce = getLatestNonce({ chainCode });

  if (savedNonce && Number(savedNonce) === Number(txNonce)) {
    txNonce = txNonce++;
  }

  updateNonce({ chainCode, nonce: txNonce });

  return txNonce;
};

export const removePendingTransaction = ({ hash, logFilePath, logPrefix = '' }) => {
  try {
    // Read the file contents
    const fileContents = fs.readFileSync(logFilePath, 'utf-8');

    // Split contents into lines
    const lines = fileContents.split('\n');

    // Filter out the line containing the hash
    const updatedLines = lines.filter((line) => !line.startsWith(`${hash} `));

    // Join the lines back and write to the file
    fs.writeFileSync(logFilePath, updatedLines.join('\n'), 'utf-8');

    console.log(
      `${logPrefix} Pending transaction with hash "${hash}" has been removed successfully.`,
    );
  } catch (error) {
    console.error(`${logPrefix} Remove transaction hash error: ${error.message}`);
  }
};

export const handleUpdatePendingItemsQueue = ({
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
    console.log(`${logPrefix} ${logFilePath} log file was successfully updated.`);
    action();
  } else {
    console.log(`${logPrefix} ${logFilePath} log file was successfully updated.`);
    fs.writeFileSync(logFilePath, '');
    oracleCache.set(jobIsRunningCacheKey, false, 0);
  }
};

// function to handle all unexpected request errors (like bad internet connection or invalid response) and add them into Error.log file
export const handleServerError = async (err, additionalMessage = null) => {
  if (additionalMessage) console.log(additionalMessage + ': ');
  console.log(err.stack);

  prepareLogDirectory(LOG_DIRECTORY_PATH_NAME, false);
  await prepareLogFile(
    { filePath: getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }) },
    false,
  );

  addLogMessage({
    filePath: getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }),
    message: replaceNewLines(
      (additionalMessage ? additionalMessage + ': ' : '') + err.stack,
    ),
  });
};

// function to handle all unexpected chains transactions errors and add them into Error.log file
export const handleChainError = ({ logMessage, consoleMessage }) => {
  console.log(consoleMessage);
  addLogMessage({
    filePath: getLogFilePath({ key: LOG_FILES_KEYS.ORACLE_ERRORS }),
    message: replaceNewLines(logMessage),
  });
};

export const getLatestNonce = ({ chainCode }) => {
  const filePath = getLogFilePath({ key: LOG_FILES_KEYS.NONCE, chainCode });

  try {
    // If file does not exist yet, create it initialized with 0
    if (!fs.existsSync(filePath)) {
      createLogFile({
        filePath,
        dataToWrite: '0',
        showSuccessConsole: true,
      });
      return 0;
    }

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return 0;

    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch (error) {
    console.error(`Get latest nonce error: ${error.message}`);
    return 0;
  }
};
