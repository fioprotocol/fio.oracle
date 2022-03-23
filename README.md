# fio.oracle
Oracle for wrapping FIO tokens and FIO domains to and from the FIO chain

## Dependencies to install

node 14

Ubuntu Server 20.04

## Environment variables

To configure your  application, create a .env file with the following parameters in the root of the fio.oracle directory.

```
MODE=                     # testnet or mainnet
SERVER_URL_HISTORY=       # URL of FIO history node
SERVER_URL_ACTION=        # URL of FIO API node
ETHERSCAN_KEY=            # Etherscan key for gas pricing
POLLTIME=                 # Seconds between poll for wrap and unwrap events (60 seconds=60000)
POLLOFFSET=               # The number of wrap transactions to get on FIO side in each call (If you set 20, you can get 20 latest actions on FIO side)
GASLIMIT=                 # The default gas limit
GASPRICE=                 # The default ethereum gas price
TGASLIMIT=                # Manual gas price and gas limit setting
TGASPRICE=                # Manual gas price and gas price setting
ETHAPIURL=                # The etherscan API URL 
USEGASAPI=                # Boolean to use manual price an limit settings or user the API (0 = manual, 1 = use API)
GASPRICELEVEL=            # Which price to use from the gas price API (low/average/high)
ETH_ORACLE_PUBLIC=        # The ETH oracle public key used for signing ERC20 transactions
ETH_ORACLE_PRIVATE=       # The ETH oracle private key used for signing ERC20 transactions
FIO_ORACLE_PRIVATE_KEY=   # The FIO private key used for approving unwrap transactions
FIO_ORACLE_PUBLIC_KEY=    # The FIO public key used for approving unwrap transactions
FIO_ORACLE_ACCOUNT=       # The FIO account used for approving unwrap transactions
FIO_ORACLE_ADDRESS=       # The FIO Crypto Handle used for approving unwrap transactions
FIO_ORACLE_WRAP_ACCOUNT=  # The FIO wrapping contract
POLYAPIURL=               # The polyscan API URL.
```

## Installation

Navigate to the directory where the files are and run the following commands:

```
npm install
npm run dev
```
