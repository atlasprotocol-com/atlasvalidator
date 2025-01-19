
Atlas Validator

This repository contains the Atlas Validator, a tool for validating deposits, redemptions, and bridgings on the Atlas platform. The validator interacts with both NEAR and Bitcoin networks.

Prerequisites
Ensure you have the following installed on your system:

Node.js
npm

Installation
Clone the repository:

```bash
git clone https://github.com/atlasprotocolxyz/atlasvalidator.git
cd atlasvalidator
```

Install dependencies:

Run the following command to install the required npm packages:

```bash
npm install
```

Configuration
The configuration file config/config.json needs to be set up correctly for the validator to interact with the NEAR and Bitcoin networks. Below is the configuration format:

{
  "near": {
    "networkId": "testnet",
    "nodeUrl": "https://rpc.testnet.near.org",
    "walletUrl": "https://wallet.testnet.near.org",
    "helperUrl": "https://helper.testnet.near.org",
    "explorerUrl": "https://explorer.testnet.near.org",
    "gas": "300000000000000",
    "contractId": "contract-id",
    "accountId": "account-id",
    "pk": "private-key"
  },
  "bitcoin": {
    "btcAtlasDepositAddress": "tb1qwn7x9qdjtftldxnl08dg8425zf04f94eltxwym",
    "btcAPI": "https://mempool.space/signet/api",
    "btcNetwork": "signet"
  }
}

Explanation of Configuration:

NEAR Configuration:

networkId: Set to testnet for the NEAR testnet.
nodeUrl: The NEAR RPC URL.
walletUrl: The URL for the NEAR wallet.
helperUrl: The URL for the NEAR helper.
explorerUrl: The URL for the NEAR explorer.
gas: The gas limit to be used for transactions.
contractId: The contract ID deployed on the NEAR testnet.
accountId: Your NEAR account ID used for transactions.
pk: The private key associated with your NEAR account.

Bitcoin Configuration:

btcAtlasDepositAddress: The Bitcoin address where deposits are monitored.
btcAPI: The API URL for accessing Bitcoin's mempool data.
btcNetwork: Set to signet for Bitcoin's Signet network.
Make sure all fields are correctly populated with your specific details.

Start the validator:

``` bash
./start.sh
```

``` windows
start.bat
```

Update Existing Repository

Navigate to your project directory:

Pull the latest changes:

``` bash
git pull origin main
```