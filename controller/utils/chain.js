import { Common, CustomChain } from '@ethereumjs/common';

import { POLYGON_TESTNET_CHAIN_ID } from '../constants/chain';

export const handlePolygonChainCommon = () => {
  if (process.env.MODE === 'testnet') {
    const customChainInstance = Common.custom(CustomChain.PolygonMumbai);
    // Polygon Mumbai has been deprecated from 13th of April 2024.
    // Using Polygon Amoy instead but it's missing on CustomChain. So chainId and networkId should be updated
    customChainInstance._chainParams.chainId = POLYGON_TESTNET_CHAIN_ID;
    customChainInstance._chainParams.networkId = POLYGON_TESTNET_CHAIN_ID;

    return customChainInstance;
  }

  return Common.custom(CustomChain.PolygonMainnet);
};

export const handleEthChainCommon = () => new Common({ chain: process.env.MODE === 'testnet' ? process.env.ETH_TESTNET_CHAIN_NAME : 'mainnet' })
