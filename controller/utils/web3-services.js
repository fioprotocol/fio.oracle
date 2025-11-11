import { createRequire } from 'node:module';

import fetch from 'node-fetch';
import { createThirdwebClient } from 'thirdweb';
import * as thirdwebChains from 'thirdweb/chains';
import { getRpcClient } from 'thirdweb/rpc';
import { Web3 } from 'web3';

const require = createRequire(import.meta.url);

import config from '../../config/config.js';
import { ACTION_TYPES } from '../constants/chain.js';

const fioABI = require('../../config/ABI/FIO.json');
const fioNftABI = require('../../config/ABI/FIOMATICNFT.json');

// --- Lightweight EIP-1193 providers with fallback chaining ---

class HttpRpcProvider {
  constructor({ url, name }) {
    this.url = url;
    this.name = name || 'HTTP';
    this._id = 1;
  }

  async request({ method, params = [] }) {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: this._id++, method, params }),
      });

      if (!res.ok) {
        let responseText = '';
        try {
          responseText = await res.text();
        } catch {}

        // Try extract JSON error message if present
        let parsed;
        try {
          parsed = JSON.parse(responseText);
        } catch {}

        const extraMsg =
          parsed && parsed.error && parsed.error.message
            ? parsed.error.message
            : (responseText || '').slice(0, 300);
        const err = new Error(
          `${this.name} ${method} -> HTTP ${res.status} ${res.statusText}${extraMsg ? `: ${extraMsg}` : ''}`,
        );
        // Only treat genuine network server-side failures/timeouts as network errors
        err.isNetworkError = res.status >= 500 || res.status === 408;
        err.isRateLimitError = res.status === 429;
        err.rpcMethod = method;
        err.statusCode = res.status;
        err.statusText = res.statusText;
        err.responseSnippet = extraMsg;
        throw err;
      }

      const json = await res.json();
      if (json.error) {
        // Propagate JSON-RPC errors enriched with context
        const err = new Error(
          `${this.name} ${method} -> ${json.error.code || 'RPC'}: ${json.error.message || 'RPC Error'}`,
        );
        err.code = json.error.code;
        err.data = json.error.data;
        err.rpcMethod = method;
        throw err;
      }
      return json.result;
    } catch (e) {
      // Attach provider name for diagnostics
      e.providerName = this.name;
      throw e;
    }
  }
}

class ThirdwebRpcProvider {
  constructor({ chainName, apiKey }) {
    this.name = 'Thirdweb';
    if (!chainName) throw new Error('Thirdweb provider requires chainName');
    // thirdweb uses secret key for server-side RPC
    const client = createThirdwebClient({ secretKey: apiKey || '' });
    const chain = thirdwebChains[chainName];
    if (!chain) throw new Error(`Thirdweb: unknown chainName ${chainName}`);
    this.rpc = getRpcClient({ client, chain });
  }

  async request({ method, params = [] }) {
    try {
      // Use thirdweb's EIP-1193 request function directly to keep raw JSON-RPC semantics
      return await this.rpc({ method, params });
    } catch (e) {
      e.providerName = this.name;
      throw e;
    }
  }
}

class MultiRpcProvider {
  constructor(providers) {
    this.providers = providers.filter(Boolean);
    if (!this.providers.length) throw new Error('No RPC providers configured');
    this.currentIndex = 0;
  }

  current() {
    return this.providers[this.currentIndex];
  }

  shouldFallbackOnError(err) {
    // Only fallback on probable network/rate-limit issues.
    const msg = (err && err.message ? err.message : '').toLowerCase();
    if (err && (err.isNetworkError || err.isRateLimitError)) return true;
    if (msg.includes('rate limit') || msg.includes('too many requests')) return true;
    if (msg.includes('network') || msg.includes('timeout')) return true;
    // Do NOT fallback on provider-enforced range limitations; upper layers will retry with smaller windows
    if (msg.includes('exceeded maximum block range')) return false;
    // Don't fallback on logical execution errors (nonce too low, reverted, etc.)
    if (msg.includes('nonce too low')) return false;
    if (msg.includes('replacement transaction underpriced')) return false;
    if (msg.includes('already known')) return false;
    if (msg.includes('execution reverted')) return false;
    return false;
  }

  async request({ method, params }) {
    let lastError = null;

    // Build a method-aware provider order
    const infura = this.providers.filter((p) => (p.name || '') === 'Infura');
    const moralis = this.providers.filter((p) => (p.name || '').startsWith('Moralis'));
    const thirdweb = this.providers.filter((p) => (p.name || '') === 'Thirdweb');
    const known = new Set([...infura, ...moralis, ...thirdweb]);
    const others = this.providers.filter((p) => !known.has(p));

    const providersToTry =
      method === 'eth_getLogs'
        ? [...infura, ...thirdweb, ...moralis, ...others]
        : [...infura, ...moralis, ...thirdweb, ...others];

    for (let i = 0; i < providersToTry.length; i++) {
      const index = (this.currentIndex + i) % providersToTry.length;
      const provider = providersToTry[index];
      try {
        const result = await provider.request({ method, params });
        // Stick to the provider that worked
        this.currentIndex = this.providers.indexOf(provider);
        return result;
      } catch (err) {
        lastError = err;
        const canFallback = this.shouldFallbackOnError(err);
        if (canFallback && i < providersToTry.length - 1) {
          const meta = {
            provider: provider.name || 'Unknown',
            method,
            status: err.statusCode,
            code: err.code,
            msg: err.message,
            details: (
              err.responseSnippet || (err.data ? JSON.stringify(err.data) : '')
            ).slice(0, 200),
          };
          console.warn(`[Web3 Fallback] Provider error, trying next`, meta);
          continue;
        }
        // Either not recoverable or no providers left
        console.error(`[Web3 Fallback] Final error`, {
          provider: provider.name || 'Unknown',
          method,
          status: err.statusCode,
          code: err.code,
          msg: err.message,
          details: (
            err.responseSnippet || (err.data ? JSON.stringify(err.data) : '')
          ).slice(0, 200),
        });
        throw err;
      }
    }
    throw lastError || new Error('All providers failed');
  }
}

// --- Helpers to build provider chain per network ---
const findChainConfigByCode = (chainCode) => {
  const { supportedChains } = config;
  for (const type of Object.keys(supportedChains)) {
    const found = (supportedChains[type] || []).find(
      (c) => c.chainParams && c.chainParams.chainCode === chainCode,
    );
    if (found) return found;
  }
  return null;
};

const buildProvidersForChain = ({ chainCode }) => {
  const chainCfg = findChainConfigByCode(chainCode) || {};
  const { infura, moralis, thirdweb } = chainCfg;

  const providers = [];

  // 1) Infura (first)
  if (infura && infura.rpcUrl && infura.apiKey) {
    providers.push(
      new HttpRpcProvider({
        url: `${infura.rpcUrl}/${infura.apiKey}`,
        name: 'Infura',
      }),
    );
  }

  // 2) Moralis primary + fallback (second by default)
  const { moralis: { MORALIS_RPC_BASE_URL, MORALIS_RPC_BASE_URL_FALLBACK } = {} } =
    config;

  if (moralis && moralis.chainName && moralis.rpcNodeApiKey) {
    const urlParams = `${moralis.chainName}/${moralis.rpcNodeApiKey}`;
    if (MORALIS_RPC_BASE_URL) {
      providers.push(
        new HttpRpcProvider({
          url: `${MORALIS_RPC_BASE_URL}/${urlParams}`,
          name: 'Moralis Primary',
        }),
      );
    }
    if (MORALIS_RPC_BASE_URL_FALLBACK) {
      providers.push(
        new HttpRpcProvider({
          url: `${MORALIS_RPC_BASE_URL_FALLBACK}/${urlParams}`,
          name: 'Moralis Fallback',
        }),
      );
    }
  }

  // 3) Thirdweb (third by default; moved ahead of Moralis on getLogs at runtime)
  if (thirdweb && thirdweb.chainName) {
    const { thirdWeb: { THIRDWEB_API_KEY } = {} } = config;
    providers.push(
      new ThirdwebRpcProvider({
        chainName: thirdweb.chainName,
        apiKey: THIRDWEB_API_KEY,
      }),
    );
  }

  return providers;
};

export class Web3Service {
  // Cache web3 instances per chain using fallback provider
  static _instances = new Map();
  static _providers = new Map();

  static getWe3Instance({ chainCode, rpcUrl, apiKey }) {
    const errorLogPrefix = `WEB3 ERROR [Get instance] chain [${chainCode}]:`;
    if (!chainCode) {
      throw new Error(`${errorLogPrefix} Chain code is required`);
    }

    if (this._instances.has(chainCode)) return this._instances.get(chainCode);

    // Build providers: prefer provided Infura details if present
    const infuraArg = rpcUrl && apiKey ? { rpcUrl, apiKey } : undefined;
    const providers = buildProvidersForChain({ chainCode, infuraArg });

    if (!providers.length) {
      // Backward-compatible strict check
      if (!rpcUrl) throw new Error(`${errorLogPrefix} RPC URL is required`);
      if (!apiKey) throw new Error(`${errorLogPrefix} API KEY is required`);
      const url = `${rpcUrl}/${apiKey}`;
      const web3Single = new Web3(url);
      this._instances.set(chainCode, web3Single);
      return web3Single;
    }
    const provider = new MultiRpcProvider(providers);
    const web3 = new Web3(provider);
    this._instances.set(chainCode, web3);
    this._providers.set(chainCode, provider);
    // console.log('WEB3', web3);
    return web3;
  }

  static getWeb3Contract({ type, chainCode, contractAddress }) {
    const web3ChainInstance = this.getWe3Instance({ chainCode });

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

  static getCurrentRpcProviderName({ chainCode }) {
    const provider = this._providers.get(chainCode);
    try {
      return provider && provider.current && provider.current().name;
    } catch {
      return null;
    }
  }

  static hasMoralisProvider({ chainCode }) {
    const provider = this._providers.get(chainCode);
    if (!provider || !provider.providers) return false;
    const isMoralisName = (prov) => (prov.name || '').toLowerCase().includes('moralis');
    return provider.providers.some(isMoralisName);
  }
}
