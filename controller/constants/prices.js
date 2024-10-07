import config from '../../config/config.js';

const {
  gas: { T_GAS_LIMIT, T_GAS_PRICE, P_GAS_LIMIT, P_GAS_PRICE },
} = config;

export const POLYGON_GAS_LIMIT = parseFloat(P_GAS_LIMIT);
export const ETH_GAS_LIMIT = parseFloat(T_GAS_LIMIT);

export const DEFAULT_POLYGON_GAS_PRICE = parseFloat(P_GAS_PRICE);
export const DEFAULT_ETH_GAS_PRICE = parseFloat(T_GAS_PRICE);
