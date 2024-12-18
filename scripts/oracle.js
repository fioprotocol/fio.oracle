import {
  handleUnwrapFromEthToFioChain,
  handleUnwrapFromPolygonToFioChain,
  handleWrapEthAction,
  handleWrapPolygonAction,
  handleBurnNFTInPolygon,
} from './oracleutils.js';
import { ETH_TOKEN_CODE, POLYGON_TOKEN_CODE } from '../controller/constants/chain.js';
import { LOG_FILES_PATH_NAMES } from '../controller/constants/log-files.js';
import {
  addLogMessage,
  prepareLogFile,
  getLatestEthNonce,
  getLatestPolygonNonce,
} from '../controller/utils/log-files.js';

const args = process.argv;

const oracle = {
  usage:
    "Usage: npm run oracle ['wrap'|'unwrap'|'burn'] ['tokens'|'domain'] [amount|domain|tokenId] [fio handle or eth address] trxid ['clean'?] [gasPrice?]\n \
    Examples: \n \
        npm run oracle wrap tokens 12000000000 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean 1650000016\n \
        npm run oracle wrap domain fiohacker 0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean 1650000016 \n \
        npm run oracle unwrap tokens 12000000000 alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean \n \
        npm run oracle unwrap domain fiohacker alice@fiotestnet ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean \n \
        npm run oracle burn domain <tokenId> <trxId> clean 1650000016",
  action: args.length > 2 ? args[2] + args[3] : 'help',
  domain: args[3] == 'domain' ? args[4] : null,
  amount: args[3] == 'tokens' ? args[4] : null,
  address: args[5],
  tokenId: args[4],
  obtid: args[2] == 'burn' ? args[5] : args[6],
  isClean: !!(args[7] && args[7] === 'clean'),
  manualSetGasPrice: args[8],
};

// Be aware! You can get replacing transaction error, when do not use 'clean' param, because of nonce collisions,
// when wrap\unwrap jobs from files queue are running.
// So the best way to run transaction would be to append it directly into log file queue or stop oracle job before script executing.
const main = async () => {
  try {
    switch (oracle.action) {
      case 'help':
        console.log(oracle.usage + '\n');
        break;
      case 'wraptokens':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.ethNonce,
          fetchAction: getLatestEthNonce,
        });

        if (oracle.isClean) {
          const wrapText =
            oracle.obtid +
            ' ' +
            JSON.stringify({
              amount: oracle.amount,
              chain_code: ETH_TOKEN_CODE,
              public_address: oracle.address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleWrapEthAction({
            amount: oracle.amount,
            address: oracle.address,
            obtId: oracle.obtid,
            manualSetGasPrice: oracle.manualSetGasPrice,
          });
        break;
      case 'wrapdomain':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.polygonNonce,
          fetchAction: getLatestPolygonNonce,
        });
        if (oracle.isClean) {
          const wrapText =
            oracle.obtid +
            ' ' +
            JSON.stringify({
              fio_domain: oracle.domain,
              chain_code: POLYGON_TOKEN_CODE,
              public_address: oracle.address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleWrapPolygonAction({
            domain: oracle.domain,
            address: oracle.address,
            obtId: oracle.obtid,
            manualSetGasPrice: oracle.manualSetGasPrice,
          });
        break;
      case 'unwraptokens':
        if (oracle.isClean) {
          const wrapText =
            oracle.obtid +
            ' ' +
            JSON.stringify({
              amount: oracle.amount,
              fioaddress: oracle.address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleUnwrapFromEthToFioChain({
            amount: oracle.amount,
            address: oracle.address,
            obtId: oracle.obtid,
          });
        break;
      case 'unwrapdomain':
        if (oracle.isClean) {
          const wrapText =
            oracle.obtid +
            ' ' +
            JSON.stringify({
              domain: oracle.domain,
              fioaddress: oracle.address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleUnwrapFromPolygonToFioChain({
            domain: oracle.domain,
            address: oracle.address,
            obtId: oracle.obtid,
          });
        break;
      case 'burndomain':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.polygonNonce,
          fetchAction: getLatestPolygonNonce,
        });

        if (oracle.isClean) {
          const wrapText =
            oracle.obtid +
            ' ' +
            JSON.stringify({
              domain: oracle.domain,
              fioaddress: oracle.address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleBurnNFTInPolygon({
            tokenId: oracle.tokenId,
            obtId: oracle.obtid,
            manualSetGasPrice: oracle.manualSetGasPrice,
          });
        break;
      default:
        console.log(`\nAction ${oracle.action} not found\n`);
        console.log(oracle.usage + '\n');
    }
  } catch (err) {
    console.log('\nError: ', err);
    if (err.json) {
      console.log('\nDetails: ', err.json);
    }
  }
};

main();
