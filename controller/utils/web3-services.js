import { createRequire } from 'node:module';

import { Web3 } from 'web3';

const require = createRequire(import.meta.url);

import { ACTION_TYPES } from '../constants/chain.js';

const fioABI = require('../../config/ABI/FIO.json');
const fioNftABI = require('../../config/ABI/FIOMATICNFT.json');

export class Web3Service {
  static getWe3Instance({ chainCode, rpcUrl, apiKey }) {
    const errorLogPrefix = `WEB3 ERROR [Get instance] chain [${chainCode}]:`;

    if (!rpcUrl) {
      throw new Error(`${errorLogPrefix} RPC URL is required`);
    }
    if (!apiKey) {
      throw new Error(`${errorLogPrefix} API KEY is required`);
    }

    if (!this[chainCode]) {
      const url = `${rpcUrl}/${apiKey}`;

      this[chainCode] = new Web3(url);
    }
    return this[chainCode];
  }

  static getWeb3Contract({ apiKey, type, chainCode, contractAddress, rpcUrl }) {
    const web3ChainInstance = this.getWe3Instance({
      chainCode,
      rpcUrl,
      apiKey,
    });

    if (!web3ChainInstance) {
      throw new Error('Web3 instance not found');
    }

    switch (type) {
      case ACTION_TYPES.TOKENS:
        return new web3ChainInstance.eth.Contract(fioABI, contractAddress);
      case ACTION_TYPES.NFTS:
        return new web3ChainInstance.eth.Contract(fioNftABI, contractAddress);
      default:
        throw new Error('Invalid chain type');
    }
  }
}
