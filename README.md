# fio.oracle
Oracle for wrapping FIO tokens and FIO domains to and from the FIO chain

## Dependencies to install

node 20.0.9

Ubuntu Server 20.04

## Environment variables

To configure your  application, create a .env file with the following parameters in the root of the fio.oracle directory.

```
MODE=                        # testnet or mainnet
PORT=                        # The port that the fio.oracle service will run on when started
FIO_SERVER_URL_HISTORY=      # URL of FIO history node
FIO_SERVER_HISTORY_VERSION=  # Version of FIO history node, (“hyperion” or “v1”, defaults to “v1”)
FIO_SERVER_URL_ACTION=       # URL of FIO API node
FIO_ORACLE_PUBLIC_KEY=       # The FIO public key used for approving unwrap transactions
FIO_ORACLE_PRIVATE_KEY=      # The FIO private key used for approving unwrap transactions
FIO_ORACLE_ACCOUNT=          # The FIO account used for approving unwrap transactions
FIO_ORACLE_ADDRESS=          # The FIO Crypto Handle for the oracle
ETH_ORACLE_PUBLIC=           # The ETH oracle public key used for signing ERC20 transactions
ETH_ORACLE_PRIVATE=          # The ETH oracle private key used for signing ERC20 transactions
POLYGON_ORACLE_PUBLIC=       # The POLYGON oracle public key used for signing ERC721 transactions
POLYGON_ORACLE_PRIVATE=      # The POLYGON oracle private key used for signing ERC721 transactions
POLLTIME=                    # Seconds between poll for wrap and unwrap events (60 seconds=60000)
POLLOFFSET=                  # The number of wrap transactions to get on FIO side in each call (If you set 20, you can get 20 latest actions on FIO side)
HYPERION_LIMIT=              # The number of actions to get from history when using hyperion version
USEGASAPI=                   # Boolean to use manual price an limit settings or user the API (0 = manual, 1 = use API)
GASPRICELEVEL=               # Which price to use from the gas price API (low/average/high)
TGASLIMIT=                   # Manual gas limit for ETH erc20
TGASPRICE=                   # Manual gas price for ETH erc20
PGASLIMIT=                   # Manual gas limit for Polygon erc721
PGASPRICE=                   # Manual gas price for Polygon erc721
ETHINFURA=                   # The Ethereum chain Infura API URL
FIO_TOKEN_ETH_CONTRACT=      # Ethereum address of the erc20 token contract
FIO_NFT_ETH_CONTRACT=        # Ethereum address of the erc721 NFT contract (Legacy, only supporting Polygon NFT for V1)
POLYGON_INFURA=              # The Polygon chain Infura API URL
FIO_NFT_POLYGON_CONTRACT=    # The Polygon address of the erc721 NFT contract
ETH_TESTNET_CHAIN_NAME=      # The Ethereum testnet chain name (e.g., sepolia)
ETH_NFT_TESTNET_CHAIN_NAME=  # The Ethereum testnet chain name for Nft (e.g., rinkeby)
POLYGON_TESTNET_CHAIN_NAME=  # The Polygon testnet chain name (e.g., matic-amoy)
BLOCKS_RANGE_LIMIT_ETH=      # The limitation for Block numbers used for ETH chain to make pastEvents contract call
BLOCKS_RANGE_LIMIT_POLY=     # The limitation for Block numbers used for Polygon chain to make pastEvents contract call
BLOCKS_OFFSET_ETH=           # The number of confirmations (blocks) required to validate Ethereum transactions 
FIO_ORACLE_PERMISSION=       # The custom permission on FIO unwrap actions (defaults to “active”)
MORALIS_API_KEY=             # Moralis API Key
MORALIS_RPC_BASE_URL=        # Moralis RPC Base Url
MORALIS_RPC_BASE_URL_FALLBACK= # Moralis Fallback RPC Base Url
MORALIS_RPC_NODE_API_KEY_ETHEREUM_MAINNET= # Moralis RPC Node API key for ETH mainnet
MORALIS_RPC_NODE_API_KEY_ETHEREUM_TESTNET= # Moralis RPC Node API key for ETH testnet
MORALIS_RPC_NODE_API_KEY_POLYGON_MAINNET=  # Moralis RPC Node API key for Polygon mainnet
MORALIS_RPC_NODE_API_KEY_POLYGON_TESTNET=  # Moralis RPC Node API key for Polygon testnet
MORALIS_RPC_ETH_CHAIN_NAME=  # Moralis RPC ETH chain name (ethereum|sepolia)
MORALIS_RPC_POLYGON_CHAIN_NAME= # Moralis RPC Polygon RPC chain name (polygon|amoy)
NFT_DEFAULT_TESTNET_CHAIN_NAME= # Default NFT chain name (POLYGON_AMOY)
NFT_MAINNET_CHAIN_NAME=     # NFT chain name mainnet (POLYGON)
THIRDWEB_API_KEY=           # Thirdweb API key

# Optional
FIO_SERVER_URL_HISTORY_BACKUP= # Backup URL of FIO history node
FIO_SERVER_HISTORY_VERSION_BACKUP= # Backup version of FIO history node, (“hyperion” or “v1”)
```

## Installation

Navigate to the directory where the files are and run the following commands:

```
npm install
npm run dev
```
