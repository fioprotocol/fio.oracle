import { handleBurnNFTInPolygon } from './oracleutils.js';
import { handleWrapAction, handleUnwrapAction } from './oracleutils.js';
import config from '../config/config.js';
import moralis from '../controller/api/moralis.js';
import { ACTIONS } from '../controller/constants/chain.js';
import { withLoadingIndicator } from '../controller/utils/general.js';
import {
  getLogFilePath,
  LOG_FILES_KEYS,
} from '../controller/utils/log-file-templates.js';
import {
  addLogMessage,
  prepareLogFile,
  getLatestNonce,
} from '../controller/utils/log-files.js';

const { supportedChains } = config;

const parseNamedParams = (args) => {
  const params = {
    action: args[2] ? args[2] : 'help',
    type: args[3] ? args[3] : 'help',
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
  wrap tokens/nfts    - Wrap tokens or nfts
  unwrap tokens/nfts  - Unwrap tokens or nfts
  burn nfts           - Burn nfts

Parameters (key:value format):
  chainCode:<code>          - all actions                                   - Chain code (ETH, POL, BASE, etc.)
  nftName:<name>            - wrap/unwrap/burn nfts                         - FIO NFT name (domain)
  tokenId:<id>              - burn nfts                                     - Token ID for burn action. Is owned by NFT contract.
  amount:<value>            - wrap/unwrap tokens                            - Amount of FIO tokens in SUF for wrap/unwrap
  address:<address>         - wrap nfts/tokens or unwrap nfts/tokens        - Ethereum address for wrap actions. FIO handle for unwrap actions.
  obtId:<obtId>             - all actions                                   - For wrap nfts/tokens obtId is oracle id value from FIO chain "fio.oracles" table. For unwrap could be useed FIO transaction hash. For burn value could be FIO transaction hash or have strucutre "<token_id>ManualDomainBurn<nftName>"
  clean:true|false          - all actions (not required)                    - Clean mode flag. Adds action to regular job list. Does not executes immediately.
  manualSetGasPrice:<price> - all actions (not required)                    - Manual gas price setting in WEI.

Examples:
  # Wrap tokens
  npm run oracle wrap tokens chainCode:ETH amount:12000000000 address:0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 obtId:944 clean:true manualSetGasPrice:1650000016

  # Wrap nfts
  npm run oracle wrap nfts chainCode:POL nftName:fiohacker address:0xe28FF0D44d533d15cD1f811f4DE8e6b1549945c9 obtId:945 clean:true manualSetGasPrice:1650000016

  # Unwrap tokens
  npm run oracle unwrap tokens chainCode:BASE amount:12000000000 address:alice@fiotestnet obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean:true

  # Unwrap nfts
  npm run oracle unwrap nfts chainCode:POL nftName:fiohacker address:alice@fiotestnet obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320 clean:true

  # Burn with only nftName
  npm run oracle burn nfts chainCode:POL nftName:fiodomainname obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320

  # Burn with only tokenId
  npm run oracle burn nfts chainCode:POL tokenId:123456 obtId:ec52a13e3fd60c1a06ad3d9c0d66b97144aa020426d91cc43565483c743dd320`;

const main = async () => {
  try {
    const params = parseNamedParams(process.argv);

    const {
      action,
      address,
      amount,
      chainCode,
      clean,
      nftName,
      manualSetGasPrice,
      obtId,
      tokenId,
      type,
    } = params;

    switch (action) {
      case 'help':
        console.log(help + '\n');
        break;
      case ACTIONS.WRAP:
        await prepareLogFile({
          filePath: getLogFilePath({ key: LOG_FILES_KEYS.NONCE, chainCode }),
          fetchAction: () => getLatestNonce({ chainCode }),
        });

        if (clean) {
          const wrapText = `${obtId} ${JSON.stringify({
            amount,
            chain_code: chainCode,
            pubaddress: address,
          })}`;
          addLogMessage({
            filePath: getLogFilePath({ key: LOG_FILES_KEYS.WRAP, chainCode, type }),
            message: wrapText,
            addTimestamp: false,
          });
        } else
          await handleWrapAction({
            action,
            address,
            amount: amount,
            chainCode,
            nftName,
            obtId,
            manualSetGasPrice,
            type,
          });
        break;
      case ACTIONS.UNWRAP:
        if (clean) {
          const unwrapText =
            obtId +
            ' ' +
            JSON.stringify({
              amount,
              fioaddress: address,
            });
          addLogMessage({
            filePath: getLogFilePath({ key: LOG_FILES_KEYS.UNWRAP, chainCode, type }),
            message: unwrapText,
            addTimestamp: false,
          });
        } else
          await handleUnwrapAction({
            action,
            address,
            amount,
            chainCode,
            nftName,
            obtId,
            type,
          });
        break;
      case ACTIONS.BURN:
        await prepareLogFile({
          filePath: getLogFilePath({ key: LOG_FILES_KEYS.NONCE, chainCode }),
          fetchAction: () => getLatestNonce({ chainCode }),
        });

        if ((!tokenId || Number.isNaN(tokenId)) && !nftName) {
          throw new Error(
            'Either tokenId or nftName parameter must be provided for burnnfts action',
          );
        }

        const currentChain = supportedChains[type].find(
          (chain) => chain.chainParams && chain.chainParams.chainCode === chainCode,
        );
        const { chainParams, contractAddress } = currentChain || {};
        const { chainId } = chainParams || {};
        let finalTokenId = tokenId;
        if ((!finalTokenId || Number.isNaN(finalTokenId)) && nftName) {
          const moralisTokenId = await withLoadingIndicator(
            moralis.getTokenIdByDomain({ nftName, chainId, contractAddress }),
            `Try to find tokenId for nftName ${nftName}`,
          );
          if (!moralisTokenId) {
            throw new Error(`Could not find tokenId for nftName: ${nftName}`);
          }
          finalTokenId = moralisTokenId;
        }
        console.log('finalTokenId', finalTokenId);
        console.log('nftName', nftName);
        if (clean) {
          const burnText = JSON.stringify({
            tokenId: finalTokenId,
            obtId,
            nftName,
          });
          addLogMessage({
            filePath: getLogFilePath({ key: LOG_FILES_KEYS.BURN_NFTS, chainCode }),
            message: burnText,
            addTimestamp: false,
          });
        } else
          await handleBurnNFTInPolygon({
            action,
            chainCode,
            obtId,
            tokenId: finalTokenId,
            manualSetGasPrice,
            type,
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
