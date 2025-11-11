# fio.oracle
Oracle:
- wrapping FIO tokens and FIO domains from the FIO chain to other chains
- unwrapping FIO tokens and FIO domains from other chains to FIO chain
- burn FIO domains from FIO chain to selected NFT chain

## Requirements

- Node.js 22.14.0
- Linux host (e.g., Ubuntu Server 20.04)

## Config And Env Overview

The app now uses the `config` package with environment-specific JSON files. Most tunables moved from `.env` into `config/*.json`.

- Base config: `config/default.json`
- Overrides by network: `config/mainnet.json`, `config/testnet.json`
- Scalar env injection (API keys, secrets): `config/custom-environment-variables.json`
- Runtime resolver for `ENV_VAR_*` placeholders inside config: `config/config.js`

Environment selection is driven by `NODE_ENV` and matching dotenv file:
- `NODE_ENV=mainnet` → loads `config/mainnet.json` and `.env.mainnet`
- `NODE_ENV=testnet` → loads `config/testnet.json` and `.env.testnet`

References:
- `config/config.js:1` explains the load order and environment selection
- `config/custom-environment-variables.json:1` maps env vars to config paths

## What Stays In .env

Create both `.env.mainnet` and `.env.testnet` in repo root (use `.env.example` as a guide): `.env.example:1`

Required/env-injected values:
- FIO keys/account
  - `FIO_ORACLE_PRIVATE_KEY`, `FIO_ORACLE_ACCOUNT`
- Chain oracle keys (used via `ENV_VAR_*` placeholders in config)
  - `ETH_ORACLE_PRIVATE`, `ETH_ORACLE_PUBLIC`
  - `POLYGON_ORACLE_PRIVATE`, `POLYGON_ORACLE_PUBLIC`
  - `BASE_ORACLE_PRIVATE`, `BASE_ORACLE_PUBLIC`
- RPC/API keys
  - `INFURA_ETH_TOKENS_API_KEY`, `INFURA_BASE_TOKENS_API_KEY`, `INFURA_POLYGON_NFTS_API_KEY`
  - `MORALIS_API_KEY`
  - `MORALIS_RPC_NODE_API_KEY_ETHEREUM`, `MORALIS_RPC_NODE_API_KEY_POLYGON`, `MORALIS_RPC_NODE_API_KEY_BASE`
  - `THIRDWEB_API_KEY`
- AWS creds for S3 log sync
  - `AWS_S3_KEY`, `AWS_S3_SECRET`, `AWS_S3_PERMITTED_FOLDER`

Moved to config (no longer in .env):
- App port, restart/retry timing, gas settings, FIO servers, job timeouts, logging flags, AWS bucket/region, etc. See `config/default.json:1`.

## Config File Structure

These are examples/skeletons showing the current shape and where values come from.

Main base config: `config/default.json:1`
```
{
  "app": { "port": 3000, "restartTimeout": 5000, "maxRetries": 5, "stabilityThreshold": 30000 },
  "autoRetryMissingActions": { "maxRetries": 5, "retryDelayMs": 5000, "timeRangeStart": 900000, "timeRangeEnd": 3600000 },
  "aws": { "s3Key": "", "s3Secret": "", "s3Bucket": "fio-oracle-logs", "s3Region": "us-east-1", "s3PermittedFolder": "" },
  "chainDefaults": { "useGasApi": 1, "gasPriceLevel": "average", "defaultHardfork": "london" },
  "fio": { "serverUrlHistory": [], "serverUrlAction": [], "getTableRowsOffset": 1000, "historyOffset": 1000, "lowestOracleId": 0, "maxRetries": 5, "privateKey": "", "account": "", "permission": "active", "serverStaleThresholdMinutes": 5 },
  "jobTimeouts": { "defaultJobTimeout": 60000, "burnDomainsJobTimeout": 10800000, "autoRetryMissingActionsTimeout": 600000 },
  "logging": { "logToFile": false, "syncIntervalHours": 1, "enableS3Sync": false },
  "moralis": { "apiKey": "", "rpcBaseUrl": "https://site1.moralis-nodes.com", "rpcBaseUrlFallback": "https://site2.moralis-nodes.com", "defaultTimeoutBetweenCalls": 1000 },
  "thirdWeb": { "apiKey": "" },
  "supportedChains": { "tokens": [], "nfts": [] }
}
```

Mainnet overrides: `config/mainnet.json:1`
```
{
  "app": { "port": 3030 },
  "fio": {
    "serverUrlHistory": ["https://fio.server-url.io/", "https://fio.server-url-2.io/"],
    "serverUrlAction":  ["https://fio.server-url.io/", "https://fio.server-url-2.io/"],
    "lowestOracleId": 900
  },
  "logging": { "enableS3Sync": false },
  "supportedChains": {
    "tokens": [
      {
        "chainParams": { "chainName": "ethereum", "chainCode": "ETH", "chainId": 1 },
        "contractAddress": "0x...",
        "contractTypeName": "fio.erc20",
        "blocksRangeLimit": 3000,
        "blocksOffset": 7,
        "gasLimit": 200000,
        "defaultGasPrice": 30,
        "infura": { "rpcUrl": "https://mainnet.infura.io/v3", "apiKey": "ENV_VAR_INFURA_ETH_TOKENS_API_KEY" },
        "moralis": { "rpcNodeApiKey": "ENV_VAR_MORALIS_RPC_NODE_API_KEY_ETHEREUM", "chainName": "eth" },
        "thirdweb": { "chainName": "ethereum" },
        "privateKey": "ENV_VAR_ETH_ORACLE_PRIVATE",
        "publicKey":  "ENV_VAR_ETH_ORACLE_PUBLIC"
      }
      // ...additional chains
    ],
    "nfts": [
      {
        "chainParams": { "chainName": "polygon", "chainCode": "POL", "chainId": 137 },
        "contractAddress": "0x...",
        "contractTypeName": "fio.erc721",
        "blocksRangeLimit": 3000,
        "gasLimit": 200000,
        "defaultGasPrice": 50,
        "infura": { "rpcUrl": "https://polygon-mainnet.infura.io/v3", "apiKey": "ENV_VAR_INFURA_POLYGON_NFTS_API_KEY" },
        "moralis": { "rpcNodeApiKey": "ENV_VAR_MORALIS_RPC_NODE_API_KEY_POLYGON", "chainName": "polygon" },
        "thirdweb": { "chainName": "polygon" },
        "privateKey": "ENV_VAR_POLYGON_ORACLE_PRIVATE",
        "publicKey":  "ENV_VAR_POLYGON_ORACLE_PUBLIC"
      }
    ]
  }
}
```

Testnet overrides: `config/testnet.json:1`
```
{
  "app": { "port": 3020 },
  "fio": {
    "serverUrlHistory": ["https://testnet.fio.server-url.io/", "https://testnet.fio.server-url-2.io/"],
    "serverUrlAction":  ["https://testnet.fio.server-url.io/", "https://testnet.fio.server-url-2.io/"],
    "lowestOracleId": 416
  },
  "supportedChains": {
    "tokens": [
      {
        "chainParams": { "chainName": "sepolia", "chainCode": "ETH", "chainId": 11155111 },
        "contractAddress": "0x...",
        "contractTypeName": "fio.erc20",
        "blocksRangeLimit": 3000,
        "blocksOffset": 7,
        "gasLimit": 200000,
        "defaultGasPrice": 30,
        "infura": { "rpcUrl": "https://sepolia.infura.io/v3", "apiKey": "ENV_VAR_INFURA_ETH_TOKENS_API_KEY" },
        "moralis": { "rpcNodeApiKey": "ENV_VAR_MORALIS_RPC_NODE_API_KEY_ETHEREUM", "chainName": "sepolia" },
        "thirdweb": { "chainName": "sepolia" },
        "privateKey": "ENV_VAR_ETH_ORACLE_PRIVATE",
        "publicKey":  "ENV_VAR_ETH_ORACLE_PUBLIC"
      }
      // ...additional chains
    ],
    "nfts": [
      {
        "chainParams": { "chainName": "polygon amoy", "chainCode": "POL", "chainId": 80002 },
        "contractAddress": "0x...",
        "contractTypeName": "fio.erc721",
        "blocksRangeLimit": 3000,
        "gasLimit": 200000,
        "defaultGasPrice": 50,
        "infura": { "rpcUrl": "https://polygon-amoy.infura.io/v3", "apiKey": "ENV_VAR_INFURA_POLYGON_NFTS_API_KEY" },
        "moralis": { "rpcNodeApiKey": "ENV_VAR_MORALIS_RPC_NODE_API_KEY_POLYGON", "chainName": "amoy" },
        "thirdweb": { "chainName": "polygonAmoy" },
        "privateKey": "ENV_VAR_POLYGON_ORACLE_PRIVATE",
        "publicKey":  "ENV_VAR_POLYGON_ORACLE_PUBLIC"
      }
    ]
  }
}
```

Notes:
- Any string value starting with `ENV_VAR_` is resolved at runtime to the respective environment variable by `config/config.js:38`.
- Scalar values like `aws.s3Key`, `fio.privateKey`, `moralis.apiKey`, `thirdWeb.apiKey` are mapped to env vars by `config/custom-environment-variables.json:1`.

## Install And Run

- Copy `.env.example` → `.env.mainnet` and `.env.testnet` and fill required keys
- Install deps: `npm install`

Run server:
- Mainnet: `npm run start` (`package.json:7`)
- Testnet: `npm run start:testnet` (`package.json:8`)

Server listens on `app.port` from config. Startup/retry behavior is controlled by values in `config/default.json:1` and logged to console. See `server.js:1` and `controller/main.js:1`.

## Manual Oracle Scripts

There is a helper CLI for on-demand wrap/unwrap/burn actions with optional queueing.

- Mainnet: `npm run oracle`
- Testnet: `npm run oracle:testnet`

Usage (from `scripts/oracle.js:1`):
```
npm run oracle <action> <type> [key:value params]

<action>: wrap | unwrap | burn
<type>:   tokens | nfts

Params (key:value):
  chainCode:<code>          - required (ETH, POL, BASE, ...)
  nftName:<name>            - for nfts (wrap/unwrap/burn)
  tokenId:<id>              - for burn nfts (optional if nftName resolves to tokenId)
  amount:<value>            - for tokens (wrap/unwrap) amount in SUF
  address:<addr>            - EVM address for wrap; FIO handle for unwrap
  obtId:<id>                - wrap: oracle id from FIO table; unwrap/burn: FIO tx hash
  clean:true|false          - if true, enqueue into normal job log instead of immediate execution
  manualSetGasPrice:<wei>   - optional manual gas price override

Examples:
  npm run oracle wrap tokens chainCode:ETH amount:12000000000 address:0x... obtId:944 clean:true manualSetGasPrice:1650000016
  npm run oracle wrap nfts chainCode:POL nftName:fiohacker address:0x... obtId:945 clean:true
  npm run oracle unwrap tokens chainCode:BASE amount:12000000000 address:alice@fiotestnet obtId:<fioTxHash>
  npm run oracle burn nfts chainCode:POL nftName:fiodomainname obtId:<fioTxHash>
```

## FIO Server Failover And Retry

Multiple FIO servers can be configured and the app rotates on failures. Configure in config:
- `fio.serverUrlHistory[]` and `fio.serverUrlAction[]` in `config/mainnet.json:1` or `config/testnet.json:1`.
- Retries and backoff settings are in `app`, `autoRetryMissingActions`, and `fio.maxRetries` in `config/default.json:1`.

## Health Check

Endpoint: `GET /api/v1/health` (`controller/routes/health.js:1`)

Example: `http://localhost:<port>/api/v1/health`

Returns 200 `{ status: "ok", timestamp: "..." }` when healthy.

## Logs And S3 Sync

- Local log roots per environment are prepared under `controller/api/`.
- S3 sync is controlled in config:
  - Enable/disable: `logging.enableS3Sync` (default false)
  - Interval hours: `logging.syncIntervalHours`
  - File vs console: `logging.logToFile`
- AWS credentials come from env; bucket/region are in config:
  - Env: `AWS_S3_KEY`, `AWS_S3_SECRET`, `AWS_S3_PERMITTED_FOLDER`
  - Config: `aws.s3Bucket`, `aws.s3Region`

Tip: On startup the app prints chain balances and gas price suggestions when `chainDefaults.useGasApi` is enabled. See `controller/main.js:1`.
