import { ACTIONS, ACTION_TYPES, handleActionName } from '../constants/chain.js';

export const isOracleAddressValid = async ({ contract, publicKey }) => {
  const registeredOraclesPublicKeys = await contract.methods.getOracles().call();

  return !!registeredOraclesPublicKeys
    .map((registeredOracle) => registeredOracle.toLowerCase())
    .includes(publicKey.toLowerCase());
};

export const executeContractAction = ({
  contract,
  actionNameType,
  amount,
  nftName,
  obtId,
  pubaddress,
  tokenId,
}) => {
  let contractFunction = null;

  switch (actionNameType) {
    case handleActionName({
      actionName: ACTIONS.WRAP,
      type: ACTION_TYPES.TOKENS,
    }): {
      contractFunction = contract.methods.wrap(pubaddress, amount, obtId);
      break;
    }
    case handleActionName({
      actionName: ACTIONS.WRAP,
      type: ACTION_TYPES.NFTS,
    }): {
      contractFunction = contract.methods.wrapnft(pubaddress, nftName, obtId);
      break;
    }
    case handleActionName({
      actionName: ACTIONS.BURN,
      type: ACTION_TYPES.NFTS,
    }): {
      contractFunction = contract.methods.burnnft(tokenId, obtId);
      break;
    }
    default:
      null;
  }

  if (!contractFunction) {
    throw Error('ExecuteContractAction has no contract function');
  }

  return contractFunction.encodeABI();
};

export const convertNativeFioIntoFio = (nativeFioValue) => {
  const fioDecimals = 1000000000;
  return parseInt(nativeFioValue + '') / fioDecimals;
};

/**
 * Estimate block range based on time range in milliseconds
 * @param {number} timeRangeMs - Time range in milliseconds
 * @returns {number} Estimated number of blocks
 */
export const estimateBlockRange = (timeRangeMs) => {
  const AVERAGE_BLOCK_TIME_MS = 2000; // 2 seconds average block time for most chains
  return Math.ceil(timeRangeMs / AVERAGE_BLOCK_TIME_MS);
};
