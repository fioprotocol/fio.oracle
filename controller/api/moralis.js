import { EvmChain } from '@moralisweb3/common-evm-utils';
import Moralis from 'moralis';
import fetch from 'node-fetch';

import config from '../../config/config.js';

import { handleBackups, sleep } from '../utils/general.js';

const {
  nfts: { NFT_CHAIN_NAME, NFT_PROVIDER_API_KEY },
  moralis: {
    MORALIS_RPC_BASE_URL,
    MORALIS_RPC_BASE_URL_FALLBACK,
    MORALIS_RPC_ETH_CHAIN_NAME,
    MORALIS_RPC_POLYGON_CHAIN_NAME,
    MORALIS_RPC_NODE_API_KEY_ETHEREUM,
    MORALIS_RPC_NODE_API_KEY_POLYGON,
    MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS,
  },
  polygon: { POLYGON_CONTRACT },
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
        `MORALIS ERROR: Resync metadata error for token id - ${nftItem.token_id}: `,
        error.message,
      );
    }

    try {
      const nftItemWithFreshMetadataRes = await Moralis.EvmApi.nft.getNFTMetadata({
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
        `MORALIS ERROR: Get metadata for token id - ${nftItem.token_id}: `,
        error.message,
      );
    }
  }

  async getContractNFTs({
    chainName = NFT_CHAIN_NAME,
    contractAddress = POLYGON_CONTRACT,
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
    contractAddress = POLYGON_CONTRACT,
    cursor,
    nftsList = [],
  }) {
    try {
      await this.init();

      let contractNftsRes = {};
      if (cursor) {
        await sleep(MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS);
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
          (nftItem) => nftItem.metadata == null,
        );
        const nftItemsWithSyncedMetadata = [];

        const processChunk = async (chunk) => {
          const nftMetadataPromises = chunk.map((nftItem) =>
            this.resyncNftMetadata(nftItem),
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
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
          }
        }

        if (nftItemsWithSyncedMetadata.length) {
          for (const nftItemWithSyncedMetadata of nftItemsWithSyncedMetadata) {
            const nonUpdatedMetadataNftItem = nftsList.find(
              (nftItem) => nftItem.token_id === nftItemWithSyncedMetadata.token_id,
            );

            if (nonUpdatedMetadataNftItem) {
              nonUpdatedMetadataNftItem.metadata = nftItemWithSyncedMetadata.metadata;
              nonUpdatedMetadataNftItem.normalized_metadata =
                nftItemWithSyncedMetadata.normalized_metadata;
            }
          }
        }
      }

      return nftsList;
    } catch (error) {
      console.log('MORALIS ERROR: Get all contract NFTs ', error);
      throw error;
    }
  }

  async findNftByMetadataName({
    metadataName,
    chainName = NFT_CHAIN_NAME,
    contractAddress = POLYGON_CONTRACT,
  }) {
    try {
      await this.init();
      let cursor = null;
      const chain = EvmChain[chainName];

      while (true) {
        let contractNftsRes;
        if (cursor) {
          await sleep(MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS);
          contractNftsRes = await cursor.next();
        } else {
          contractNftsRes = await this.getContractNFTs({
            chainName,
            contractAddress,
          });
        }

        const contractNftsResData = contractNftsRes.toJSON();

        if (contractNftsResData && contractNftsResData.result) {
          for (const nftItem of contractNftsResData.result) {
            let { metadata, normalized_metadata } = nftItem;

            // If no metadata, try to resync and get fresh metadata
            if (!metadata && !normalized_metadata) {
              const freshMetadata = await this.resyncNftMetadata({
                chain,
                nftItem,
              });
              if (freshMetadata) {
                metadata = freshMetadata.metadata;
                normalized_metadata = freshMetadata.normalized_metadata;
              }
            }

            let currentMetadataName = null;

            // Try normalized metadata first
            if (normalized_metadata && normalized_metadata.name) {
              currentMetadataName = normalized_metadata.name;
            }
            // Fall back to parsing raw metadata
            else if (metadata) {
              try {
                const parsedMetadata = JSON.parse(metadata);
                if (parsedMetadata && parsedMetadata.name) {
                  currentMetadataName = parsedMetadata.name;
                }
              } catch (error) {
                console.error('Failed to parse metadata:', error);
                continue;
              }
            }

            // Extract name after ": " and compare
            const name = currentMetadataName && currentMetadataName.split(': ')[1];
            if (name === metadataName) {
              return nftItem;
            }
          }
        }

        if (!contractNftsRes.hasNext()) {
          break;
        }
        cursor = contractNftsRes;
      }

      return null;
    } catch (error) {
      console.error('MORALIS ERROR: Find NFT by metadata name:', error);
      throw error;
    }
  }

  async getTokenIdByDomain({
    domain,
    chainName = NFT_CHAIN_NAME,
    contractAddress = POLYGON_CONTRACT,
  }) {
    try {
      const nftItem = await this.findNftByMetadataName({
        metadataName: domain,
        chainName,
        contractAddress,
      });

      return nftItem ? nftItem.token_id : null;
    } catch (error) {
      console.error('MORALIS ERROR: Get token ID by domain:', error);
      throw error;
    }
  }
}

const getGasPrices = async ({ chainName, rpcNodeApiKey, isRetry }) => {
  const urlParams = `${chainName}/${rpcNodeApiKey}`;

  const primaryUrl = `${MORALIS_RPC_BASE_URL}/${urlParams}`;
  const fallbackUrl = `${MORALIS_RPC_BASE_URL_FALLBACK}/${urlParams}`;

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
    return await handleBackups(fetchGasPrice, isRetry, fallbackUrl);
  } catch (error) {
    console.error('MORALIS Both primary and fallback RPC URLs failed:', error);
    throw new Error(
      'MORALIS Failed to fetch gas prices from both primary and fallback RPC URLs.',
    );
  }
};

export const getMoralisEthGasPrice = async () => {
  try {
    return await getGasPrices({
      chainName: MORALIS_RPC_ETH_CHAIN_NAME,
      rpcNodeApiKey: MORALIS_RPC_NODE_API_KEY_ETHEREUM,
    });
  } catch (error) {
    console.log('MORALIS ERROR: ETH GAS PRICE', error);
    throw error;
  }
};

export const getMoralisPolygonGasPrice = async () => {
  try {
    return await getGasPrices({
      chainName: MORALIS_RPC_POLYGON_CHAIN_NAME,
      rpcNodeApiKey: MORALIS_RPC_NODE_API_KEY_POLYGON,
    });
  } catch (error) {
    console.log('MORALIS ERROR: POLYGON GAS PRICE', error);
    throw error;
  }
};

export default new GetMoralis();
