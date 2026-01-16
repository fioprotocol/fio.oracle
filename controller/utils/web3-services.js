import { createRequire } from 'node:module';

import { createThirdwebClient } from 'thirdweb';
import * as thirdwebChains from 'thirdweb/chains';
import { getRpcClient } from 'thirdweb/rpc';
import { Web3 } from 'web3';

const require = createRequire(import.meta.url);

import { fetchWithTimeout } from './fetch-with-timeout.js';
import config from '../../config/config.js';
import { ACTION_TYPES } from '../constants/chain.js';
import {
  NETWORK_ERROR_CODES,
  NETWORK_ERROR_MESSAGES,
  NO_FALLBACK_ERROR_MESSAGES,
} from '../constants/transactions.js';

const fioABI = require('../../config/ABI/FIO.json');
const fioNftABI = require('../../config/ABI/FIOMATICNFT.json');

// Get fetch timeout from config for error messages
const FETCH_TIMEOUT_MS = (config.app && config.app.FETCH_TIMEOUT_MS) || 60000;

// RPC method constants
const ETH_GET_LOGS = 'eth_getLogs';

// --- Lightweight EIP-1193 providers with fallback chaining ---

class HttpRpcProvider {
  constructor({ url, name }) {
    this.url = url;
    this.name = name || 'HTTP';
    this._id = 1;
  }

  async request({ method, params = [] }) {
    try {
      const res = await fetchWithTimeout(this.url, {
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
        // Treat auth errors (401/403) as fallback-eligible since one provider's API key might be invalid
        err.isAuthError = res.status === 401 || res.status === 403;
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
      // Handle timeout errors from fetchWithTimeout
      if (e.isTimeoutError || e.name === 'TimeoutError') {
        const err = new Error(
          `${this.name} ${method} -> Request timeout after ${FETCH_TIMEOUT_MS}ms`,
        );
        err.isNetworkError = true;
        err.isTimeoutError = true;
        err.providerName = this.name;
        err.rpcMethod = method;
        throw err;
      }

      // Attach provider name for diagnostics
      e.providerName = this.name;

      // Mark DNS and fetch-level network errors as network errors for fallback
      const errMsg = (e.message || '').toLowerCase();
      if (
        NETWORK_ERROR_CODES.includes(e.code) ||
        NETWORK_ERROR_MESSAGES.some((msg) => errMsg.includes(msg)) ||
        e.name === 'FetchError'
      ) {
        e.isNetworkError = true;
      }

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
    // Use native requestTimeoutMs config
    this.rpc = getRpcClient({
      client,
      chain,
      config: { requestTimeoutMs: FETCH_TIMEOUT_MS },
    });
  }

  async request({ method, params = [] }) {
    try {
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
  }

  current() {
    return this.providers[0];
  }

  shouldFallbackOnError(err) {
    const msg = (err && err.message ? err.message : '').toLowerCase();
    if (NO_FALLBACK_ERROR_MESSAGES.some((pattern) => msg.includes(pattern))) return false;
    return true;
  }

  getProviderPriority({ providerName, isGetLogs = false }) {
    const name = (providerName || '').toLowerCase();
    const priorityKey = isGetLogs ? 'GET_LOGS_PRIORITY' : 'PRIORITY';

    for (const [key, providerConfig] of Object.entries(config.web3Providers)) {
      if (name.includes(key.toLowerCase())) {
        return providerConfig[priorityKey] ?? 999;
      }
    }
    return 999;
  }

  // Get block range limit for a provider from config
  getProviderBlocksRangeLimit(providerName) {
    const name = (providerName || '').toLowerCase();

    for (const [key, providerConfig] of Object.entries(config.web3Providers)) {
      if (name.includes(key.toLowerCase())) {
        return providerConfig.BLOCKS_RANGE_LIMIT;
      }
    }
    return null;
  }

  // Execute eth_getLogs with provider's block range limit from config
  async executeGetLogs({ provider, params }) {
    const filter = params[0];
    const fromBlock = parseInt(filter.fromBlock, 16);
    const toBlock = parseInt(filter.toBlock, 16);
    const limit = this.getProviderBlocksRangeLimit(provider.name);

    // If no limit configured or request fits within limit, just execute
    if (!limit || toBlock - fromBlock + 1 <= limit) {
      return await provider.request({ method: ETH_GET_LOGS, params });
    }

    // Chunk based on provider's config limit
    const results = [];
    for (let start = fromBlock; start <= toBlock; start += limit) {
      const end = Math.min(toBlock, start + limit - 1);
      const chunkParams = [
        {
          ...filter,
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
        },
      ];
      const chunk = await provider.request({
        method: ETH_GET_LOGS,
        params: chunkParams,
      });
      if (chunk && chunk.length) results.push(...chunk);
    }
    return results;
  }

  async request({ method, params }) {
    let lastError = null;
    const isGetLogs = method === ETH_GET_LOGS;

    const providersToTry = [...this.providers].sort((a, b) => {
      const priorityA = this.getProviderPriority({ providerName: a.name, isGetLogs });
      const priorityB = this.getProviderPriority({ providerName: b.name, isGetLogs });
      return priorityA - priorityB;
    });

    for (let i = 0; i < providersToTry.length; i++) {
      const provider = providersToTry[i];

      try {
        // For eth_getLogs, use provider's block range limit from config
        if (isGetLogs) {
          return await this.executeGetLogs({ provider, params });
        }
        return await provider.request({ method, params });
      } catch (err) {
        lastError = err;
        const canFallback = this.shouldFallbackOnError(err);

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

        if (canFallback && i < providersToTry.length - 1) {
          console.warn(
            `[Web3 Fallback] Provider "${provider.name}" error, trying next`,
            meta,
          );
          continue;
        }

        console.error(`[Web3 Fallback] Final error`, meta);
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
  const moralisConfig = config.web3Providers.moralis || {};
  const MORALIS_RPC_BASE_URL = moralisConfig.RPC_BASE_URL || '';
  const MORALIS_RPC_BASE_URL_FALLBACK = moralisConfig.RPC_BASE_URL_FALLBACK || '';

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
    const thirdwebConfig = config.web3Providers.thirdweb || {};
    const THIRDWEB_API_KEY = thirdwebConfig.API_KEY || '';
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
  // Cache contract instances to prevent memory leaks from repeated instantiation
  static _contracts = new Map();

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
    // Create cache key based on chain, type, and address
    const cacheKey = `${chainCode}-${type}-${contractAddress}`;

    // Return cached contract if it exists
    if (this._contracts.has(cacheKey)) {
      return this._contracts.get(cacheKey);
    }

    const web3ChainInstance = this.getWe3Instance({ chainCode });

    if (!web3ChainInstance) {
      throw new Error('Web3 instance not found');
    }

    let contract;
    switch (type) {
      case ACTION_TYPES.TOKENS:
        contract = new web3ChainInstance.eth.Contract(fioABI, contractAddress);
        break;
      case ACTION_TYPES.NFTS:
        contract = new web3ChainInstance.eth.Contract(fioNftABI, contractAddress);
        break;
      default:
        throw new Error('Invalid chain type');
    }

    // Cache the contract instance for reuse
    this._contracts.set(cacheKey, contract);
    return contract;
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

  static hasThirdwebProvider({ chainCode }) {
    const provider = this._providers.get(chainCode);
    if (!provider || !provider.providers) return false;
    const isThirdwebName = (prov) => (prov.name || '').toLowerCase().includes('thirdweb');
    return provider.providers.some(isThirdwebName);
  }

  /**
   * Clear cached contract instances (useful for cleanup or testing)
   * @param {string} chainCode - Optional chain code to clear specific contracts
   * @param {string} type - Optional type to clear specific contracts
   */
  static clearContractCache({ chainCode, type } = {}) {
    if (!chainCode && !type) {
      // Clear all contracts
      const count = this._contracts.size;
      this._contracts.clear();
      console.log(`[Web3Service] Cleared ${count} cached contract instances`);
      return count;
    }

    // Clear specific contracts matching criteria
    let cleared = 0;
    for (const [key] of this._contracts) {
      const shouldClear =
        (!chainCode || key.startsWith(`${chainCode}-`)) &&
        (!type || key.includes(`-${type}-`));

      if (shouldClear) {
        this._contracts.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(
        `[Web3Service] Cleared ${cleared} cached contract instances for ${chainCode || 'all chains'}, ${type || 'all types'}`,
      );
    }
    return cleared;
  }
}
