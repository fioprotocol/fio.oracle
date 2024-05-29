import Moralis from 'moralis';
import { EvmChain } from '@moralisweb3/common-evm-utils';
import fetch from 'node-fetch';

import config from '../../config/config.js';

import { handleBackups } from '../utils/general.js';

const {
  FIO_NFT_POLYGON_CONTRACT,
  NFTS: { NFT_CHAIN_NAME, NFT_PROVIDER_API_KEY },
} = config;

const CHUNK_SIZE = 2;
const DELAY_BETWEEN_CHUNKS = 500;

class GetMoralis {
  async init() {
    if (!Moralis.Core._isStarted)
      await Moralis.start({
        apiKey: NFT_PROVIDER_API_KEY,
      });
  }

  async resyncNftMetadata({ chain, nftItem }) {
    try {
      await Moralis.EvmApi.nft.reSyncMetadata({
        chain,
        flag: 'metadata',
        mode: 'async',
        address: nftItem.token_address,
        tokenId: nftItem.token_id,
      });
    } catch (error) {
      console.error(
        `Resync metadata error for token id - ${nftItem.token_id}: `,
        error.message
      );
    }

    try {
      const nftItemWithFreshMetadataRes =
        await Moralis.EvmApi.nft.getNFTMetadata({
          chain,
          address: nftItem.token_address,
          tokenId: nftItem.token_id,
          normalizeMetadata: true,
          format: 'decimal',
          mediaItems: false,
        });
      return nftItemWithFreshMetadataRes.toJSON();
    } catch (error) {
      console.error(
        `Get metadata for token id - ${nftItem.token_id}: `,
        error.message
      );
    }
  }

  async getContractNFTs({
    chainName = NFT_CHAIN_NAME,
    contractAddress = FIO_NFT_POLYGON_CONTRACT,
    cursor,
  }) {
    const chain = EvmChain[chainName];

    return await Moralis.EvmApi.nft.getContractNFTs({
      address: contractAddress,
      cursor,
      chain,
      format: 'decimal',
      normalizeMetadata: true,
    });
  }

  async getAllContractNFTs({
    chainName = NFT_CHAIN_NAME,
    contractAddress = FIO_NFT_POLYGON_CONTRACT,
    cursor,
    nftsList = [],
  }) {
    await this.init();

    let contractNftsRes = {};
    if (cursor) {
      contractNftsRes = await cursor.next();
    } else {
      contractNftsRes =
        (await this.getContractNFTs({
          chainName,
          contractAddress,
          cursor,
        })) || {};
    }

    const contractNftsResData = contractNftsRes.toJSON();

    if (contractNftsResData && contractNftsResData.result) {
      nftsList.push(...contractNftsResData.result);

      if (contractNftsRes.hasNext()) {
        await this.getAllContractNFTs({
          chainName,
          contractAddress,
          cursor: contractNftsRes,
          nftsList,
        });
      }
    }

    if (nftsList.some((nftItem) => nftItem.metadata == null)) {
      const nftItemsWithNoMetadata = nftsList.filter(
        (nftItem) => nftItem.metadata == null
      );
      const nftItemsWithSyncedMetadata = [];

      const processChunk = async (chunk) => {
        const nftMetadataPromises = chunk.map((nftItem) =>
          this.resyncNftMetadata(nftItem)
        );

        const chunkResults = await Promise.allSettled(nftMetadataPromises);

        const resolvedChunkResults = chunkResults
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);

        nftItemsWithSyncedMetadata.push(...resolvedChunkResults);
      };

      for (let i = 0; i < nftItemsWithNoMetadata.length; i += CHUNK_SIZE) {
        const chunk = nftItemsWithNoMetadata.slice(i, i + CHUNK_SIZE);

        await processChunk(chunk);

        if (i + CHUNK_SIZE < nftItemsWithNoMetadata.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_CHUNKS)
          );
        }
      }

      if (nftItemsWithSyncedMetadata.length) {
        for (const nftItemWithSyncedMetadata of nftItemsWithSyncedMetadata) {
          const nonUpdatedMetadataNftItem = nftsList.find(
            (nftItem) => nftItem.token_id === nftItemWithSyncedMetadata.token_id
          );

          if (nonUpdatedMetadataNftItem) {
            nonUpdatedMetadataNftItem.metadata =
              nftItemWithSyncedMetadata.metadata;
            nonUpdatedMetadataNftItem.normalized_metadata =
              nftItemWithSyncedMetadata.normalized_metadata;
          }
        }
      }
    }

    return nftsList;
  }
}

const getGasPrices = async ({ chainName, rpcNodeApiKey, isRetry }) => {
  const urlParams = `${chainName}/${rpcNodeApiKey}`;

  const primaryUrl = `${config.MORALIS_RPC_BASE_URL}/${urlParams}`;
  const fallbackUrl = `${config.MORALIS_RPC_BASE_URL_FALLBACK}/${urlParams}`;

  const fetchGasPrice = async (url) => {
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_gasPrice',
      }),
    };

    const response = await fetch(url ? url : primaryUrl, options);

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    let gasPrice = null;
    const gasEstimateResponse = await response.json();

    if (gasEstimateResponse && gasEstimateResponse.result) {
      gasPrice = parseInt(gasEstimateResponse.result);
    }

    return gasPrice;
  };


  try {
    return await handleBackups(
      fetchGasPrice,
      isRetry,
      fallbackUrl
    );
  } catch (error) {
    console.error('MORALIS Both primary and fallback RPC URLs failed:', error);
    throw new Error(
      'MORALIS Failed to fetch gas prices from both primary and fallback RPC URLs.'
    );
  }
};

export const getMoralisEthGasPrice = async () => await getGasPrices({
  chainName: config.MORALIS_RPC_ETH_CHAIN_NAME,
  rpcNodeApiKey: config.MORALIS_RPC_NODE_API_KEY_ETHEREUM,
});

export const getMoralisPolygonGasPrice = async () =>
  await getGasPrices({
    chainName: config.MORALIS_RPC_POLYGON_CHAIN_NAME,
    rpcNodeApiKey: config.MORALIS_RPC_NODE_API_KEY_POLYGON,
  });

export default new GetMoralis();
