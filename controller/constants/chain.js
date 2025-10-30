export const FIO_CHAIN_NAME = 'FIO';

export const ACTIONS = {
  WRAP: 'wrap',
  UNWRAP: 'unwrap',
  BURN: 'burn',
};

export const CONTRACT_NAMES = {
  ERC_20: 'fio.erc20',
  ERC_721: 'fio.erc721',
};

export const FIO_ACCOUNT_NAMES = {
  FIO_ADDRESS: 'fio.address',
  FIO_ORACLE: 'fio.oracle',
};

export const FIO_TABLE_NAMES = {
  FIO_ORACLE_LDGRS: 'oracleldgrs',
  FIO_DOMAINS: 'domains',
};

export const ACTION_TYPES = {
  TOKENS: 'tokens',
  NFTS: 'nfts',
};

export const CONTRACT_ACTIONS = {
  UNWRAPPED: 'unwrapped',
};

export const FIO_CONTRACT_ACTIONS = {
  [ACTIONS.UNWRAP]: {
    [ACTION_TYPES.TOKENS]: 'unwraptokens',
    [ACTION_TYPES.NFTS]: 'unwrapdomain',
  },
  [ACTIONS.BURN]: 'burnnft',
};

export const handleActionName = ({ actionName, type }) => {
  // Allow passing either enum keys (e.g., 'WRAP', 'TOKENS') or values ('wrap', 'tokens')
  const actionValue = ACTIONS[actionName] || actionName;
  const typeValue = ACTION_TYPES[type] || type;
  return `${actionValue} ${typeValue}`;
};
