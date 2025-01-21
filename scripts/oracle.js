import {
  handleUnwrapFromEthToFioChain,
  handleUnwrapFromPolygonToFioChain,
  handleWrapEthAction,
  handleWrapPolygonAction,
  handleBurnNFTInPolygon,
} from './oracleutils.js';
import moralis from '../controller/api/moralis.js';
import { ETH_TOKEN_CODE, POLYGON_TOKEN_CODE } from '../controller/constants/chain.js';
import { LOG_FILES_PATH_NAMES } from '../controller/constants/log-files.js';
import { withLoadingIndicator } from '../controller/utils/general.js';
import {
  addLogMessage,
  prepareLogFile,
  getLatestEthNonce,
  getLatestPolygonNonce,
} from '../controller/utils/log-files.js';

const parseNamedParams = (args) => {
  const params = {
    action: args[2] ? args[2] + args[3] : 'help',
  };

  args.slice(4).forEach((arg) => {
    const [key, value] = arg.split(':');
    if (value) {
      switch (key) {
        case 'clean':
          params[key] = value.toLowerCase() === 'true';
          break;
        case 'manualSetGasPrice':
        case 'amount':
        case 'tokenId':
          params[key] = Number(value);
          break;
        default:
          params[key] = value;
      }
    }
  });
  return params;
};

const help = `Usage: npm run oracle <action1> <action2> [parameters]
Actions:
  wrap tokens/domain    - Wrap tokens or domains
  unwrap tokens/domain  - Unwrap tokens or domains
  burn domain           - Burn tokens or domains

Parameters (key:value format):
  domain:<name>             - wrap/unwrap/burn domain                       - FIO domain name
  tokenId:<id>              - burn domain                                   - Token ID for burn action. Is owned by NFT contract.
  amount:<value>            - wrap/unwrap tokens                            - Amount of FIO tokens in SUF for wrap/unwrap
  address:<address>         - wrap domain/tokens or unwrap domain/tokens    - Ethereum address for wrap actions. FIO handle for unwrap actions.
  obtId:<obtId>             - all actions                                   - For wrap domain/tokens obtId is oracle id value from FIO chain "fio.oracles" table. For unwrap could be useed FIO transaction hash. For burn value could be FIO transaction hash or have strucutre "<token_id>ManualDomainBurn<domain>"
  clean:true|false          - all actions (not required)                    - Clean mode flag. Adds action to regular job list. Does not executes immediately.
  manualSetGasPrice:<price> - all actions (not required)                    - Manual gas price setting in WEI.

Examples:
  # Wrap tokens
  npm run oracle wrap tokens amount:12000000000 address:0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 obtId:944 clean:true manualSetGasPrice:1650000016

  # Wrap domain
  npm run oracle wrap domain domain:fiohacker address:0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 obtId:945 clean:true manualSetGasPrice:1650000016

  # Unwrap tokens
  npm run oracle unwrap tokens amount:12000000000 address:alice@fiotestnet obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean:true

  # Unwrap domain
  npm run oracle unwrap domain domain:fiohacker address:alice@fiotestnet obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean:true

  # Burn with only domain
  npm run oracle burn domain domain:fiodomainname obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320

  # Burn with only tokenId
  npm run oracle burn domain tokenId:123456 obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320`;

const main = async () => {
  try {
    const params = parseNamedParams(process.argv);

    const { action, address, amount, clean, domain, manualSetGasPrice, obtId, tokenId } =
      params;

    switch (action) {
      case 'help':
        console.log(help + '\n');
        break;
      case 'wraptokens':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.ethNonce,
          fetchAction: getLatestEthNonce,
        });

        if (clean) {
          const wrapText =
            obtId +
            ' ' +
            JSON.stringify({
              amount,
              chain_code: ETH_TOKEN_CODE,
              public_address: address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.wrapEthTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleWrapEthAction({
            amount: amount,
            address,
            obtId,
            manualSetGasPrice,
          });
        break;
      case 'wrapdomain':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.polygonNonce,
          fetchAction: getLatestPolygonNonce,
        });
        if (clean) {
          const wrapText =
            obtId +
            ' ' +
            JSON.stringify({
              fio_domain: domain,
              chain_code: POLYGON_TOKEN_CODE,
              public_address: address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleWrapPolygonAction({
            domain,
            address,
            obtId,
            manualSetGasPrice,
          });
        break;
      case 'unwraptokens':
        if (clean) {
          const wrapText =
            obtId +
            ' ' +
            JSON.stringify({
              amount,
              fioaddress: address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleUnwrapFromEthToFioChain({
            amount,
            address,
            obtId,
          });
        break;
      case 'unwrapdomain':
        if (clean) {
          const wrapText =
            obtId +
            ' ' +
            JSON.stringify({
              domain,
              fioaddress: address,
            });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue,
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleUnwrapFromPolygonToFioChain({
            domain,
            address,
            obtId,
          });
        break;
      case 'burndomain':
        await prepareLogFile({
          filePath: LOG_FILES_PATH_NAMES.polygonNonce,
          fetchAction: getLatestPolygonNonce,
        });

        if ((!tokenId || Number.isNaN(tokenId)) && !domain) {
          throw new Error(
            'Either tokenId or domain parameter must be provided for burn domain action',
          );
        }

        let finalTokenId = tokenId;
        if ((!finalTokenId || Number.isNaN(finalTokenId)) && domain) {
          const moralisTokenId = await withLoadingIndicator(
            moralis.getTokenIdByDomain({ domain }),
            `Try to find tokenId for domain ${domain}`,
          );
          if (!moralisTokenId) {
            throw new Error(`Could not find tokenId for domain: ${domain}`);
          }
          finalTokenId = moralisTokenId;
        }
        console.log('finalTokenId', finalTokenId);
        console.log('domain', domain);
        if (clean) {
          const burnText = JSON.stringify({
            tokenId: finalTokenId,
            obtId,
            domainName: domain,
          });
          addLogMessage({
            filePath: LOG_FILES_PATH_NAMES.burnNFTTransactionsQueue,
            message: burnText,
            addTimestamp: false,
          });
        } else
          await handleBurnNFTInPolygon({
            tokenId: finalTokenId,
            obtId,
            manualSetGasPrice,
          });
        break;
      default:
        console.log(`\nAction ${action} not found\n`);
        console.log(help + '\n');
    }
  } catch (err) {
    console.log('\nError: ', err);
    if (err.json) {
      console.log('\nDetails: ', err.json);
    }
  }
};

main();
