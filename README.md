# fio.oracle
Oracle:
- wrapping FIO tokens and FIO domains from the FIO chain to other chains
- unwrapping FIO tokens and FIO domains from other chains to FIO chain
- burn FIO domains from FIO chain to selected NFT chain

## Dependencies to install

node 20.14.0

Ubuntu Server 20.04

## Environment variables

To configure your application, create a .env files with the following parameters in the root of the fio.oracle directory.
There are 2 types of .env files:
1) `.env.mainnet` - for mainnet env vars
2) `.env.testnet` - for testnet env vars

```
PORT=                        # The port that the fio.oracle service will run on when started

FIO_SERVER_URL_HISTORY=      # URL of FIO history node
FIO_SERVER_URL_ACTION=       # URL of FIO API node

FIO_HISTORY_HYPERION_OFFSET= # The number of actions to get from history when using hyperion version
FIO_TRANSACTION_MAX_RETRIES= # The number of retries when FIO action call fails
FIO_GET_TABLE_ROWS_OFFSET=   # Offset for FIO get tables rows action

FIO_ORACLE_PRIVATE_KEY=      # The FIO private key used for approving unwrap transactions
FIO_ORACLE_ACCOUNT=          # The FIO account used for approving unwrap transactions
FIO_ORACLE_PERMISSION=       # The custom permission on FIO unwrap actions (defaults to “active”)

ETH_ORACLE_PUBLIC=           # The ETH oracle public key used for signing ERC20 transactions
ETH_ORACLE_PRIVATE=          # The ETH oracle private key used for signing ERC20 transactions
ETH_CHAIN_NAME=              # The Ethereum chain name for mainnet = 'mainnet' for testnet = 'sepolia' (any other ETH testnet name)
ETH_CONTRACT=                # Ethereum address of the erc20 token contract
ETH_NFT_CONTRACT=            # Ethereum address of the erc721 NFT contract (Legacy, only supporting Polygon NFT for V1)
BLOCKS_RANGE_LIMIT_ETH=      # The limitation for Block numbers used for ETH chain to make pastEvents contract call
BLOCKS_OFFSET_ETH=           # The number of confirmations (blocks) required to validate Ethereum transactions 

POLYGON_ORACLE_PUBLIC=       # The POLYGON oracle public key used for signing ERC721 transactions
POLYGON_ORACLE_PRIVATE=      # The POLYGON oracle private key used for signing ERC721 transactions
POLYGON_CONTRACT=            # The Polygon address of the erc721 NFT contract
BLOCKS_RANGE_LIMIT_POLY=     # The limitation for Block numbers used for Polygon chain to make pastEvents contract call

NFT_CHAIN_NAME=              # NFT chain name (POLYGON|POLYGON-AMOY)

JOB_TIMEOUT=                 # Milliseconds between running job events (60 seconds=60000)
BURN_DOMAINS_JOB_TIMEOUT=    # Milliseconds between running burn domains job event (3 hrs = 10800000)
DEFAULT_MAX_RETRIES=         # Max retries for fetch actions (set 5 by default)

USE_GAS_API=                 # Boolean to use manual price an limit settings or user the API (0 = manual, 1 = use API)
GAS_PRICE_LEVEL=             # Which price to use from the gas price API (low/average/high)
T_GAS_LIMIT=                 # Manual gas limit for ETH erc20
T_GAS_PRICE=                 # Manual gas price for ETH erc20
P_GAS_LIMIT=                 # Manual gas limit for Polygon erc721
P_GAS_PRICE=                 # Manual gas price for Polygon erc721

MORALIS_API_KEY=             # Moralis API Key
MORALIS_RPC_BASE_URL=        # Moralis RPC Base Url
MORALIS_RPC_BASE_URL_FALLBACK=      # Moralis Fallback RPC Base Url
MORALIS_RPC_NODE_API_KEY_ETHEREUM=  # Moralis RPC Node API key for ETH
MORALIS_RPC_NODE_API_KEY_POLYGON=   # Moralis RPC Node API key for Polygon
MORALIS_RPC_ETH_CHAIN_NAME=         # Moralis RPC ETH chain name (ethereum|sepolia)
MORALIS_RPC_POLYGON_CHAIN_NAME=     # Moralis RPC Polygon RPC chain name (polygon|amoy)
MORALIS_DEFAULT_TIMEOUT_BETWEEN_CALLS= # Moralis timeout between calls

THIRDWEB_API_KEY=            # Thirdweb API key

INFURA_ETH=                  # The Ethereum chain Infura API URL
INFURA_POLYGON=              # The Polygon chain Infura API URL

# Optional
FIO_SERVER_URL_ACTION_BACKUP= # Backup URL of FIO action node
FIO_SERVER_URL_HISTORY_BACKUP= # Backup URL of FIO history node
```

## Installation

Navigate to the directory where the files are and run the following commands:

```
npm install
npm run start
```

To run testnet you need to run
```
npm run start:testnet
```

## Log files

Log files for different environments are in different folders:
- controller/api/logs-mainnet
- controller/api/logs-testnet
