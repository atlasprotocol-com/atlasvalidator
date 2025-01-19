const { Web3 } = require("web3");
const { bytesToHex } = require("@ethereumjs/util");
const { FeeMarketEIP1559Transaction } = require("@ethereumjs/tx");
const { Common } = require("@ethereumjs/common");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");

const { getConstants } = require("../constants");

const {
  deriveChildPublicKey,
  najPublicKeyStrToUncompressedHexPoint,
  uncompressedHexPointToEvmAddress,
} = require("./kdf");

const { EVENT_NAME } = getConstants(); // Access constants dynamically

class Ethereum {
  constructor(chainID, rpcUrl, gasLimit, aBTCAddress, abiPath) {
    this.contractABI = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, abiPath), "utf-8")
    );

    this.web3 = new Web3(rpcUrl);
    this.abtcContract = new this.web3.eth.Contract(
      this.contractABI,
      aBTCAddress
    );
    this.chainID = Number(chainID);
    this.gasLimit = gasLimit;
    this.aBTCAddress = aBTCAddress;
  }

  async queryGasPrice() {
    const maxFeePerGas = await this.web3.eth.getGasPrice();
    const maxPriorityFeePerGas = await this.web3.eth.getMaxPriorityFeePerGas();
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async getBalance(accountId) {
    const balance = await this.web3.eth.getBalance(accountId);
    const ONE_ETH = 1000000000000000000n;
    return Number((balance * 100n) / ONE_ETH) / 100;
  }

  async createPayload(sender, receiver, amount) {
    const common = new Common({ chain: this.chainID });

    // Get the nonce & gas price
    const nonce = await this.web3.eth.getTransactionCount(sender);
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.queryGasPrice();

    // Construct transaction
    const transactionData = {
      nonce,
      gasLimit: 21000,
      maxFeePerGas,
      maxPriorityFeePerGas,
      to: receiver,
      value: BigInt(this.web3.utils.toWei(amount, "ether")),
      chain: this.chainID,
    };

    console.log(transactionData);

    const transaction = FeeMarketEIP1559Transaction.fromTxData(
      transactionData,
      { common }
    );
    const payload = transaction.getHashedMessageToSign();

    return { transaction, payload };
  }

  async createMintaBtcSignedTx(near, sender, btcTxnHash) {
    // Get the nonce & gas price
    // console.log(`Getting nonce...`);
    const nonce = await this.web3.eth.getTransactionCount(sender);

    const { maxFeePerGas, maxPriorityFeePerGas } = await this.queryGasPrice();

    const payloadHeader = {
      btc_txn_hash: btcTxnHash,
      nonce: Number(nonce), // Convert BigInt to Number
      gas: Math.min(this.gasLimit, Number(maxFeePerGas)), // assuming gasLimit is a number
      max_fee_per_gas: Number(maxFeePerGas), // Convert BigInt to Number
      max_priority_fee_per_gas: Number(maxPriorityFeePerGas), // Convert BigInt to Number
    };

    const result = await near.createMintaBtcSignedTx(payloadHeader);

    const signedTransaction = new Uint8Array(result);

    return signedTransaction;
  }

  async createMintBridgeABtcSignedTx(near, sender, txnHash) {
    // Get the nonce & gas price
    // console.log(`Getting nonce...`);
    const nonce = await this.web3.eth.getTransactionCount(sender);

    const { maxFeePerGas, maxPriorityFeePerGas } = await this.queryGasPrice();

    const payloadHeader = {
      txn_hash: txnHash,
      nonce: Number(nonce), // Convert BigInt to Number
      gas: Math.min(this.gasLimit, Number(maxFeePerGas)), // assuming gasLimit is a number
      max_fee_per_gas: Number(maxFeePerGas), // Convert BigInt to Number
      max_priority_fee_per_gas: Number(maxPriorityFeePerGas), // Convert BigInt to Number
    };

    const result = await near.createBridgingAbtcSignedTx(payloadHeader);

    const signedTransaction = new Uint8Array(result);

    return signedTransaction;
  }
  // This is a sample function for send eth transaction, Arbitrum gasLimit set to 5 million
  async createSendEthPayload(sender, receiver, amount) {
    const common = new Common({ chain: this.chainID });

    // Get the nonce & gas price
    const nonce = await this.web3.eth.getTransactionCount(sender);
    console.log(`Nonce: ${nonce}`);

    const { maxFeePerGas, maxPriorityFeePerGas } = await this.queryGasPrice();
    console.log(`maxFeePerGas: ${maxFeePerGas}`);
    console.log(`maxPriorityFeePerGas: ${maxPriorityFeePerGas}`);

    // Construct transaction
    const transactionData = {
      nonce,
      gasLimit: 5000000, // 5 million
      maxFeePerGas,
      maxPriorityFeePerGas,
      to: receiver,
      value: BigInt(this.web3.utils.toWei(amount, "ether")),
      chain: this.chainID,
    };

    console.log(transactionData);

    const transaction = FeeMarketEIP1559Transaction.fromTxData(
      transactionData,
      { common }
    );
    const payload = transaction.getHashedMessageToSign();

    return { transaction, payload };
  }

  // This code can be used to actually relay the transaction to the Ethereum network
  async relayTransaction(signedTransaction) {
    const serializedTx = bytesToHex(signedTransaction);
    console.log(serializedTx);
    const relayed = await this.web3.eth.sendSignedTransaction(serializedTx);
    const txnHash = relayed.transactionHash;
    const status = relayed.status;

    return { txnHash, status };
  }

  // Function to get the current block number
  async getCurrentBlockNumber() {
    return await this.web3.eth.getBlockNumber();
  }

  // Get block number by timestamp using binary search
  async getBlockNumberByTimestamp(timestamp) {
    const latestBlock = await this.web3.eth.getBlock("latest");
    let startBlock = BigInt(0); // Ensure startBlock is a BigInt
    let endBlock = BigInt(latestBlock.number); // Ensure endBlock is a BigInt

    // Binary search to find the block closest to the timestamp
    while (startBlock <= endBlock) {
      const midBlock = (startBlock + endBlock) / 2n; // BigInt division
      const midBlockData = await this.web3.eth.getBlock(Number(midBlock)); // Convert midBlock to a regular number for web3 call

      if (BigInt(midBlockData.timestamp) < BigInt(timestamp)) {
        startBlock = midBlock + 1n;
      } else {
        endBlock = midBlock - 1n;
      }
    }

    const closestBlockData = await this.web3.eth.getBlock(Number(startBlock));
    return closestBlockData.number;
  }

  // Function to get block by number
  async getBlock(blockNumber) {
    return await this.web3.eth.getBlock(blockNumber);
  }

  // Function to get past events in batches
  // TO-DO: Create indexer so do not need to fetch all Burn Events for every run
  async getPastBurnEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches... ${startBlock} -> ${endBlock}`);

    return this._scanEvents(
      EVENT_NAME.BURN_REDEEM,
      startBlock,
      endBlock,
      batchSize
    );
  }

  // Function to get past events in batches
  // TO-DO: Create indexer so do not need to fetch all Burn Events for every run
  async getPastBurnBridgingEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches... ${startBlock} -> ${endBlock}`);

    return this._scanEvents(
      EVENT_NAME.BURN_BRIDGE,
      startBlock,
      endBlock,
      batchSize
    );
  }

  async getPastMintEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches... ${startBlock} -> ${endBlock}`);

    return this._scanEvents(
      EVENT_NAME.MINT_DEPOSIT,
      startBlock,
      endBlock,
      batchSize
    );
  }

  async getPastMintBridgeEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches... ${startBlock} -> ${endBlock}`);

    return this._scanEvents(
      EVENT_NAME.MINT_BRIDGE,
      startBlock,
      endBlock,
      batchSize
    );
  }

  async _scanEvents(
    eventName,
    startBlock,
    endBlock,
    batchSize,
    wallet,
    concurrency = 1
  ) {
    const ranges = _.range(Number(startBlock), Number(endBlock), batchSize);

    const items = [];
    for (let i = 0; i < ranges.length; i += 1) {
      items.push({
        from: ranges[i],
        to: Math.min(ranges[i] + batchSize - 1, Number(endBlock)),
      });
    }

    const events = [];

    const chunk = _.chunk(items, concurrency);
    for (let i = 0; i < chunk.length; i++) {
      const found = await Promise.all(
        chunk[i].map(async (x) => {
          console.log(`---------- ${eventName}: ${x.from} -> ${x.to}`);
          const filters = { fromBlock: BigInt(x.from), toBlock: BigInt(x.to) };
          // wallet is indexed so we can filter by wallet
          if (wallet) filters.wallet = wallet;

          const items = await this.abtcContract.getPastEvents(
            eventName,
            filters
          );

          return items;
        })
      );
      events.push(..._.flatten(found));
    }

    return events;
  }

  // Request Signature to MPC
  async requestSignatureToMPC(near, path, ethPayload, transaction, sender) {
    // Ask the MPC to sign the payload
    //const payload = Array.from(ethPayload.reverse());
    const payload = Array.from(ethPayload);
    const signArgs = {
      payload: payload,
      path: path,
      key_version: 0,
    };

    //await near.reInitialiseConnection();

    const result = await near.nearMPCContract.sign({
      args: { request: signArgs },
      gas: "300000000000000",
      amount: 1,
    });

    /*
    const result = await near.account.signAndSendTransaction({
      receiverId: near.mpcContractId,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'sign',
            args,
            gas,
            deposit,
          },
        },
      ],
    });
    */

    const r = Buffer.from(`${result.big_r.affine_point.substring(2)}`, "hex");
    const s = Buffer.from(`${result.s.scalar}`, "hex");

    // const signature = {
    //   r: `0x${result.big_r.affine_point.substring(2)}`,
    //   s: `0x${result.s.scalar}`,
    //   yParity: result.recovery_id,
    // };

    //console.log(signature)

    const candidates = [0n, 1n].map((v) => transaction.addSignature(v, r, s));
    const signature = candidates.find((c) => {
      const senderAddress = c.getSenderAddress().toString().toLowerCase();
      return senderAddress === sender.toLowerCase();
    });

    if (signature.getValidationErrors().length > 0)
      throw new Error("Transaction validation errors");
    if (!signature.verifySignature()) throw new Error("Signature is not valid");

    return signature;
  }

  async deriveEthAddress(rootPublicKey, accountId, derivationPath) {
    //const rootPublicKey = 'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3';

    const publicKey = await deriveChildPublicKey(
      await najPublicKeyStrToUncompressedHexPoint(rootPublicKey),
      accountId,
      derivationPath
    );

    return await uncompressedHexPointToEvmAddress(publicKey);
  }
}
module.exports = { Ethereum };
