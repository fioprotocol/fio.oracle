import Moralis from 'moralis';

import config from '../../config/config.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

import { handleBackups, sleep } from '../utils/general.js';

const {
  web3Providers: {
    moralis: {
      API_KEY: MORALIS_API_KEY,
      RPC_BASE_URL: MORALIS_RPC_BASE_URL,
      RPC_BASE_URL_FALLBACK: MORALIS_RPC_BASE_URL_FALLBACK,
      DEFAULT_TIMEOUT_BETWEEN_CALLS: MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS,
    },
  },
} = config;

const CHUNK_SIZE = 2;
const DELAY_BETWEEN_CHUNKS = 500;

class GetMoralis {
  async init() {
    if (!Moralis.Core._isStarted)
      await Moralis.start({
        apiKey: MORALIS_API_KEY,
      });
  }

  async resyncNftMetadata({ chainId, nftItem }) {
    try {
      await Moralis.EvmApi.nft.reSyncMetadata({
        chain: chainId,
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
        chain: chainId,
        address: nftItem.token_address,
        tokenId: nftItem.token_id,
        normalizeMetadata: true,
        format: 'decimal',
        mediaItems: false,
      });

      if (!nftItemWithFreshMetadataRes) {
        console.error(
          `MORALIS ERROR: Get metadata returned null for token id - ${nftItem.token_id}`,
        );
        return null;
      }

      return nftItemWithFreshMetadataRes.toJSON();
    } catch (error) {
      console.error(
        `MORALIS ERROR: Get metadata for token id - ${nftItem.token_id}: `,
        error.message,
      );
      return null;
    }
  }

  async getContractNFTs({ chainId, contractAddress, cursor }) {
    return await Moralis.EvmApi.nft.getContractNFTs({
      address: contractAddress,
      cursor,
      chain: chainId,
      format: 'decimal',
      normalizeMetadata: true,
    });
  }

  async getAllContractNFTs({ chainId, contractAddress, cursor, nftsList = [] }) {
    try {
      await this.init();

      let contractNftsRes = {};
      if (cursor) {
        await sleep(MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS);
        contractNftsRes = await cursor.next();
      } else {
        contractNftsRes =
          (await this.getContractNFTs({
            chainId,
            contractAddress,
            cursor,
          })) || {};
      }

      const contractNftsResData = contractNftsRes.toJSON();

      if (contractNftsResData && contractNftsResData.result) {
        nftsList.push(...contractNftsResData.result);

        console.log(
          '[MORALIS GET ALL CONTRACT NFTs] NFTs length',
          contractNftsRes.result && contractNftsRes.result.length,
        );
        console.log(
          '[MORALIS GET ALL CONTRACT NFTs] has next',
          contractNftsRes.hasNext(),
        );

        if (contractNftsRes.hasNext()) {
          await this.getAllContractNFTs({
            chainId,
            contractAddress,
            cursor: contractNftsRes,
            nftsList,
          });
        } else {
          // Only sync metadata once when we've finished fetching all NFTs
          if (nftsList.some((nftItem) => nftItem.metadata == null)) {
            const nftItemsWithNoMetadata = nftsList.filter(
              (nftItem) => nftItem.metadata == null,
            );
            const nftItemsWithSyncedMetadata = [];

            console.log('NFT items with no metadata:', nftItemsWithNoMetadata.length);

            const processChunk = async (chunk) => {
              const nftMetadataPromises = chunk.map((nftItem) =>
                this.resyncNftMetadata({ chainId, nftItem }),
              );

              const chunkResults = await Promise.allSettled(nftMetadataPromises);

              const resolvedChunkResults = chunkResults
                .filter((result) => result.status === 'fulfilled')
                .map((result) => result.value)
                .filter((result) => result != null);

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
        }
      }

      return nftsList;
    } catch (error) {
      console.log('MORALIS ERROR: Get all contract NFTs ', error);
      throw error;
    }
  }

  async findNftByMetadataName({ metadataName, chainId, contractAddress }) {
    try {
      await this.init();
      let cursor = null;

      while (true) {
        let contractNftsRes;
        if (cursor) {
          await sleep(MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS);
          contractNftsRes = await cursor.next();
        } else {
          contractNftsRes = await this.getContractNFTs({
            chainId,
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
                chain: chainId,
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

  async getTokenIdByDomain({ nftName, chainId, contractAddress }) {
    try {
      const nftItem = await this.findNftByMetadataName({
        metadataName: nftName,
        chainId,
        contractAddress,
      });

      return nftItem ? nftItem.token_id : null;
    } catch (error) {
      console.error('MORALIS ERROR: Get token ID by nftName:', error);
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

    const response = await fetchWithTimeout(url ? url : primaryUrl, options);

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

export const getMoralisGasPrice = async ({ chainName, moralis }) => {
  const { chainName: moralisChainName, rpcNodeApiKey } = moralis || {};

  const errorLogPrefix = `MORALIS ERROR [Get gas price] chain [${chainName}]:`;

  if (!moralisChainName) {
    throw new Error(`${errorLogPrefix} Chain name is required.`);
  }

  if (!rpcNodeApiKey) {
    throw new Error(`${errorLogPrefix} RPC node API Key is required.`);
  }

  try {
    return await getGasPrices({
      chainName: moralisChainName,
      rpcNodeApiKey,
    });
  } catch (error) {
    console.error(`${errorLogPrefix} ${error}`);
    throw error;
  }
};

export default new GetMoralis();
