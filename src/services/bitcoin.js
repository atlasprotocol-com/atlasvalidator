const axios = require("axios");
const ethers = require("ethers");
const bitcoin = require("bitcoinjs-lib");
const ecc = require("@bitcoinerlab/secp256k1");
const { BorshSchema, borshSerialize, borshDeserialize } = require('borsher');
const zlib = require('zlib');

const {
  derivep2wpkhChildPublicKey,
  najPublicKeyStrToUncompressedHexPoint,
  uncompressedHexPointToSegwitAddress,
} = require("../services/kdf");
const fetchWithRetry = require("../utils/fetchWithRetry");
const { getConstants } = require("../constants");

const { magicHash } = require('./message');


// Initialize ECC library
bitcoin.initEccLib(ecc);

// Define the schema for our data structure - using minimal field names and optimal types
const schema = BorshSchema.Struct({
  n: BorshSchema.String,  // network -> n
  a: BorshSchema.String,  // address -> a
  1: BorshSchema.u16,  // num1 -> 1
  2: BorshSchema.u16,  // num2 -> 2
  3: BorshSchema.u16,  // num3 -> 3
});

// Data class
class OpReturnData {
  constructor(props) {
      this.n = props.n;
      this.a = props.a;
      this[1] = props[1];
      this[2] = props[2];
      this[3] = props[3];
  }
}

class Bitcoin {
  constructor(chain_rpc, network) {
    this.chain_rpc = chain_rpc;

    this.network =
      network === "testnet" || network === "signet" || network === "testnet4"
        ? bitcoin.networks.testnet // This will select either 'testnet' or 'signet'
        : bitcoin.networks.bitcoin; // Default to mainnet if neither testnet nor signet is specified
  }

  async getBalance(address) {
    //console.log(`${this.chain_rpc}/address/${address}/utxo`);

    const response = await axios.get(
      `${this.chain_rpc}/address/${address}/utxo`,
    );
    const balance = response.data.reduce((acc, utxo) => acc + utxo.value, 0);

    return balance;
  }

  

  async getMockPayload(
    sender,
    receiver,
    satoshis,
    redemptionTxnHash,
    taxPercentage,
    treasury,
  ) {
    const utxos = await this.fetchUTXOs(sender);
    const feeRate = await this.fetchFeeRate();
    const psbt = new bitcoin.Psbt({ network: this.network });

    let totalInput = 0;
    let selectedUtxos = [];

    // Sort UTXOs by value in ascending order (smallest to largest)
    utxos.sort((a, b) => a.value - b.value);

    // Select UTXOs until the totalInput is enough to cover the satoshis + estimated fee + tax
    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      selectedUtxos.push(utxo);
      totalInput += utxo.value;

      const estimatedSize = selectedUtxos.length * 148 + 34 + 100; // Approximate calculation
      const estimatedFee = Math.round(feeRate * estimatedSize);
      const taxAmount =
        taxPercentage > 0 ? Math.round(satoshis * taxPercentage) : 0;
      const requiredAmount = Number(satoshis) + estimatedFee + taxAmount;

      if (totalInput >= requiredAmount) {
        break;
      }
    }

    if (totalInput < Number(satoshis)) {
      throw new Error("Not enough funds to cover the transaction.");
    }

    await Promise.all(
      selectedUtxos.map(async (utxo) => {
        const transaction = await this.fetchTransaction(utxo.txid);
        let inputOptions;

        if (transaction.outs[utxo.vout].script.includes("0014")) {
          inputOptions = {
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
              script: transaction.outs[utxo.vout].script,
              value: utxo.value,
            },
          };
        } else {
          inputOptions = {
            hash: utxo.txid,
            index: utxo.vout,
            nonWitnessUtxo: Buffer.from(transaction.toHex(), "hex"),
          };
        }

        psbt.addInput(inputOptions);
      }),
    );

    let data = redemptionTxnHash;

    psbt.addOutput({
      script: bitcoin.script.compile([
        bitcoin.opcodes.OP_RETURN,
        Buffer.from(data),
      ]),
      value: 0,
    });

    const estimatedSize = selectedUtxos.length * 148 + 34 + 100; // Approximate calculation
    const estimatedFee = Math.round(feeRate * estimatedSize);
    const taxAmount =
      taxPercentage > 0 ? Math.round(satoshis * taxPercentage) : 0;

    let receiveAmount = Number(satoshis) - estimatedFee - taxAmount;
    let change = totalInput - Number(satoshis);

    if (receiveAmount > 0) {
      psbt.addOutput({
        address: receiver,
        value: receiveAmount,
      });
    }

    if (change > 0) {
      psbt.addOutput({
        address: sender,
        value: change,
      });
    }

    if (taxAmount > 0) {
      psbt.addOutput({
        address: treasury,
        value: taxAmount,
      });
    }

    return {
      psbt,
      utxos: selectedUtxos,
      estimatedFee,
      taxAmount,
      receiveAmount,
      change,
    };
  }

  async createSendBridgingFeesTransaction(near, sender) {
    // Fetch UTXOs for the sender
    const utxos = await this.fetchUTXOs(sender);

    // Fetch the current fee rate from an external source
    const feeRate = await this.fetchFeeRate() + 1;

    // Prepare the payload header to send to the NEAR contract
    const payloadHeader = {
      sender: sender,
      utxos: utxos,
      fee_rate: feeRate,
    };

    // Call the NEAR contract method to create the transaction
    const result = await near.createSendBridgingFeesTransaction(payloadHeader);

    // Destructure the result from the NEAR contract
    const {
      psbt,
      utxos: selectedUtxos, 
      estimated_fee: estimatedFee,
      protocol_fee: protocolFee,
      receive_amount: receiveAmount,
      change,
      yield_provider_gas_fee: yieldProviderGasFee,
      txn_hashes: txnHashes,
    } = result;

    // Return the necessary information as a JSON object
    return {
      psbt,
      utxos: selectedUtxos,
      estimatedFee,
      protocolFee,  
      receiveAmount,
      change,
      yieldProviderGasFee,
      txnHashes
    };
  }
  
  async createPayload(near, sender, txnHashes) {
    // Fetch UTXOs for the sender
    const utxos = await this.fetchUTXOs(sender);

    // Fetch the current fee rate from an external source
    const feeRate = await this.fetchFeeRate() + 1;

    // Prepare the payload header to send to the NEAR contract
    const payloadHeader = {
      sender: sender,
      utxos: utxos,
      fee_rate: feeRate,
      txn_hashes: txnHashes,
    };

    // Call the NEAR contract method to create the transaction
    const result = await near.createRedeemAbtcTransaction(payloadHeader);

    // Destructure the result from the NEAR contract
    const {
      psbt,
      utxos: selectedUtxos,
      estimated_fee: estimatedFee,
      protocol_fee: protocolFee,
      receive_amount: receiveAmount,
      change,
      yield_provider_gas_fee: yieldProviderGasFee,
    } = result;

    // Return the necessary information
    return {
      psbt,
      utxos: selectedUtxos,
      estimatedFee,
      protocolFee,
      receiveAmount,
      change,
      yieldProviderGasFee
    };
  }

  async requestSignatureToMPC(near, btcPayload, publicKey) {
    const { psbt, utxos } = btcPayload;

    // Bitcoin needs to sign multiple utxos, so we need to pass a signer function
    const sign = async (tx) => {
      const btcPayload = Array.from(ethers.getBytes(tx));

      const result = await near.createAtlasSignedPayload(
        btcPayload,
        psbt,
      );

      const big_r = result.big_r.affine_point;
      const big_s = result.s.scalar;

      return this.reconstructSignature(big_r, big_s);
    };

    for (let i = 0; i < utxos.length; i++) {
      console.log(`MPC_SIGN #${i} / ${utxos.length}`);
      await psbt.signInputAsync(i, { publicKey, sign });
    }

    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }

  reconstructSignature(big_r, big_s) {
    const r = big_r.slice(2).padStart(64, "0");
    const s = big_s.padStart(64, "0");

    const rawSignature = Buffer.from(r + s, "hex");

    if (rawSignature.length !== 64) {
      throw new Error("Invalid signature length.");
    }

    return rawSignature;
  }

  // This code can be used to actually relay the transaction to the Ethereum network
  async relayTransaction(signedTransaction) {
    //console.log(this.chain_rpc);
    const response = await axios.post(
      `${this.chain_rpc}/tx`,
      signedTransaction,
    );

    return response.data;
  }

  /**
   * Converts a value from satoshis to bitcoins.
   *
   * @param {number} satoshi - The amount in satoshis to convert.
   * @returns {number} The equivalent amount in bitcoins.
   */
  static toBTC(satoshi) {
    return satoshi / 100000000;
  }

  /**
   * Converts a value from bitcoins to satoshis.
   *
   * @param {number} btc - The amount in bitcoins to convert.
   * @returns {number} The equivalent amount in satoshis.
   */
  static toSatoshi(btc) {
    return Number(btc * 100000000);
  }

  /**
   * Fetches the current fee rate from the Bitcoin network.
   * This method queries the RPC endpoint for fee estimates and returns the fee rate
   * expected for a transaction to be confirmed within a certain number of blocks.
   * The confirmation target is set to 6 blocks by default, which is commonly used
   * for a balance between confirmation time and cost.
   *
   * @returns {Promise<number>} A promise that resolves to the fee rate in satoshis per byte.
   * @throws {Error} Throws an error if the fee rate data for the specified confirmation target is missing.
   */
  async fetchFeeRate() {
    try {
      const response = await axios.get(`${this.chain_rpc}/v1/fees/recommended`);
      const feeRates = response.data;
      if (feeRates.fastestFee) {
        return Math.ceil(feeRates.fastestFee);
      }
    } catch (error) {
      console.warn("Error fetching fee rates by mempool:", error.message);
    }
    throw new Error("Cannot estimate bitcoin gas fee rate");

  }

  /**
   * Fetches the Unspent Transaction Outputs (UTXOs) for a given Bitcoin address.
   *
   * @param {string} address - The Bitcoin address for which to fetch the UTXOs.
   * @returns {Promise<Array<{ txid: string; vout: number; value: number }>>} A promise that resolves to an array of UTXOs.
   * Each UTXO is represented as an object containing the transaction ID (`txid`), the output index within that transaction (`vout`),
   * and the value of the output in satoshis (`value`).
   */
  async fetchUTXOs(address) {
    const response = await axios.get(
      `${this.chain_rpc}/address/${address}/utxo`,
    );

    const utxos = response.data.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      script: "",
    }));
    return utxos;
  }

  /**
   * Fetches a Bitcoin transaction by its ID and constructs a transaction object.
   * This function retrieves the transaction details from the blockchain using the RPC endpoint,
   * then parses the input and output data to construct a `bitcoin.Transaction` object.
   *
   * @param {string} transactionId - The ID of the transaction to fetch.
   * @returns {Promise<bitcoin.Transaction>} A promise that resolves to a `bitcoin.Transaction` object representing the fetched transaction.
   */
  async fetchTransaction(transactionId) {
    const { data } = await axios.get(`${this.chain_rpc}/tx/${transactionId}`);
    const tx = new bitcoin.Transaction();


    tx.version = data.version;
    tx.locktime = data.locktime;

    data.vin.forEach((vin) => {
      const txHash = Buffer.from(vin.txid, "hex").reverse();
      const vout = vin.vout;
      const sequence = vin.sequence;
      const scriptSig = vin.scriptsig
        ? Buffer.from(vin.scriptsig, "hex")
        : undefined;
      tx.addInput(txHash, vout, sequence, scriptSig);
    });

    data.vout.forEach((vout) => {
      const value = vout.value;
      const scriptPubKey = Buffer.from(vout.scriptpubkey, "hex");
      tx.addOutput(scriptPubKey, value);
    });

    data.vin.forEach((vin, index) => {
      if (vin.witness && vin.witness.length > 0) {
        const witness = vin.witness.map((w) => Buffer.from(w, "hex"));
        tx.setWitness(index, witness);
      }
    });

    return tx;
  }

  async fetchRawTransaction(transactionId) {
    const { data } = await axios.get(`${this.chain_rpc}/tx/${transactionId}`);
    return data;
  }

  // Function which returns the txn's sender address
  async getBtcSenderAddress(txn) {
    const output = txn.vin[0].prevout.scriptpubkey_address;
    return output;
  }

  // Function which returns the txn's btc amount based on receiverAddress
  async getBtcReceivingAmount(txn, receiverAddress) {
    const output = txn.vout.find(
      (vout) => vout.scriptpubkey_address === receiverAddress
    );
    return output ? output.value : 0;
  }

  // Function which returns the txn's receiving chain and receiving address based on OP_RETURN code
  async getChainAndAddressFromTxnHash(txn) {
    let chain = null;
    let address = null;
    let remarks = "";
    let yieldProviderGasFee = 0;
    let protocolFee = 0;
    let mintingFee = 0;

    try {
      for (const vout of txn.vout) {
        const scriptPubKey = Buffer.from(vout.scriptpubkey, "hex");
        const chunks = bitcoin.script.decompile(scriptPubKey);
        if (chunks[0] === bitcoin.opcodes.OP_RETURN) {
          const embeddedData = chunks[1];

          try {
            // First try the new compressed format
            const decoded = await this.decodeOpReturnData(embeddedData);
            return {
              chain: decoded.n,
              address: decoded.a,
              yieldProviderGasFee: Number(decoded[1]),
              protocolFee: Number(decoded[2]),
              mintingFee: Number(decoded[3]),
              remarks,
            };
          } catch (decodeError) {
            // If decoding fails, try the old comma-separated format
            const dataStr = embeddedData.toString("utf-8");
            [chain, address, yieldProviderGasFee, protocolFee, mintingFee] = dataStr.split(",");
            
            return {
              chain,
              address,
              yieldProviderGasFee: Number(yieldProviderGasFee),
              protocolFee: Number(protocolFee),
              mintingFee: Number(mintingFee),
              remarks,
            };
          }
        }
      }

      throw new Error(`No embedded data found.`);
    } catch (error) {
      remarks = `Error from retrieveOpReturnFromTxnHash: ${error.message}`;
      //console.error(remarks);
      return { chain, address, yieldProviderGasFee: Number(yieldProviderGasFee), remarks };
    }
  }

  // Fetch BTC mempool data and getting unconfirmed transaction time for a particular txn
  async fetchUnconfirmedTransactionTime(txn) {
    try {
      console.log(`Getting unconfirmed txns...`);
      const axioConfig = {
        url: `${this.chain_rpc}/v1/transaction-times`,
        method: "get",
        params: { txId: [txn.txid] },
      };
      const response = await fetchWithRetry(axioConfig);
      const time = response.data[0];
      console.log(`Unconfirmed txn hash ${txn.txid} time: ${time}`);
      return time;
    } catch (error) {
      throw new Error(
        `Failed to fetch unconfirmed transactions: ${error.message}`,
      );
    }
  }

  // Fetch BTC mempool transactions based on address
  async fetchTxnsByAddress(address) {
    const axioConfig = {
      url: `${this.chain_rpc}/address/${address}/txs`,
      method: "get",
    };
    const response = await fetchWithRetry(axioConfig);

    return response;
  }

  /**
   * Get the count of pending (unconfirmed) outgoing transactions for an address
   * @param {string} address - The Bitcoin address to check
   * @returns {Promise<number>} - The number of unconfirmed outgoing transactions
   */
  async getPendingOutCount(address) {
    try {
      const response = await this.fetchTxnsByAddress(address);
      
      // Filter for unconfirmed outgoing transactions
      const pendingOutgoing = response.data.filter(tx => {
        // Check if transaction has any input from the address (outgoing)
        const hasMatchingInput = tx.vin.some(input => 
          input.prevout.scriptpubkey_address === address
        );
        
        // Check if transaction is unconfirmed
        const isUnconfirmed = !tx.status.confirmed;
        
        return hasMatchingInput && isUnconfirmed;
      });

      return pendingOutgoing.length;
    } catch (error) {
      console.error('Error getting pending outgoing transactions:', error);
      throw new Error(`Failed to get pending outgoing count: ${error.message}`);
    }
  }

  // Fetch BTC mempool transaction based on transaction ID
  // Refer https://mempool.space/docs/api/rest#get-transaction
  async fetchTxnByTxnID(txnID) {
    const axioConfig = {
      url: `${this.chain_rpc}/tx/${txnID}`,
      method: "get",
    };
    const response = await fetchWithRetry(axioConfig);

    return response.data;
  }

  async fetchTxSpentByTxnID(txnID) {
    const axioConfig = {
      url: `${this.chain_rpc}/tx/${txnID}/outspend/0`,
      method: "get",
    };
    const response = await fetchWithRetry(axioConfig);

    return response.data;
  }

  /**
     * Get the number of confirmations for a transaction based on its block height
     * @param {number} txBlockHeight - The block height of the transaction
     * @returns {Promise<number>} - The number of confirmations
     */
  async getConfirmations(txBlockHeight) {
    try {
        // Get the current block height
        const response = await axios.get(`${this.chain_rpc}/blocks/tip/height`);
        const currentBlockHeight = response.data;

        // Calculate confirmations (current height - tx block height + 1)
        const confirmations = currentBlockHeight - txBlockHeight + 1;

        // Return 0 if negative (shouldn't happen in normal cases)
        return Math.max(0, confirmations);
    } catch (error) {
        console.error('Error getting confirmations:', error);
        throw new Error(`Failed to get confirmations: ${error.message}`);
    }
  }

  async getCurrentBlockHeight() {
    try {
        // Get the current block height
        const response = await axios.get(`${this.chain_rpc}/blocks/tip/height`);
        const currentBlockHeight = response.data;
        return currentBlockHeight;
    } catch (error) {
        console.error('Error getting current block height:', error);
        throw new Error(`Failed to get current block height: ${error.message}`);
    }
  }

  async deriveBTCAddress(near) {
    const { NETWORK_TYPE } = getConstants();

    const publicKey = await derivep2wpkhChildPublicKey(
      await najPublicKeyStrToUncompressedHexPoint(await near.nearMPCContract.public_key()),
      near.contract_id,
      NETWORK_TYPE.BITCOIN,
    );

    const address = await uncompressedHexPointToSegwitAddress(
      publicKey,
      this.network,
    );

    return { publicKey: Buffer.from(publicKey, "hex"), address };
  }

  async addUtxosToPsbt(psbt, selectedUtxos) {
    for (const utxo of selectedUtxos) {
      // Fetch the transaction details using the txid
      const transaction = await this.fetchTransaction(utxo.txid);

      let inputOptions;

      // Check script type based on prefix
      if (transaction.outs[utxo.vout].script.includes("5120")) {
        // Taproot input (P2TR)
        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: transaction.outs[utxo.vout].script,
            value: utxo.value,
          },
          tapInternalKey: transaction.outs[utxo.vout].script.slice(2), // Remove 5120 prefix
        };
      } else if (transaction.outs[utxo.vout].script.includes("0014")) {
        // SegWit input (P2WPKH)
        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: transaction.outs[utxo.vout].script,
            value: utxo.value,
          },
        };
      } else {
        // Legacy input (P2PKH)
        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(transaction.toHex(), "hex"),
        };
      }

      // Add the input to the PSBT
      psbt.addInput(inputOptions);
    }
  }

  async mpcSignPsbt(near,psbtHex) {
    // Parse the PSBT
    const psbt = bitcoin.Psbt.fromHex(psbtHex, {network: this.network});
    
    const { publicKey } = await this.deriveBTCAddress(near);
    const sign = async (tx) => {
      
      const btcPayload = Array.from(ethers.getBytes(tx));
      console.log("Signing transaction:", btcPayload);
      const result =
        await near.createAtlasSignedPayload(btcPayload);

      const big_r = result.big_r.affine_point;
      const big_s = result.s.scalar;

      return this.reconstructSignature(big_r, big_s);
    };

    // Log the inputs
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      console.log(`Signing input ${i}:`, psbt.data.inputs[i]);
      await psbt.signInputAsync(i, { publicKey, sign });
    }

    return psbt;
  }

  async mpcSignMessage(near, message) {
    const msgHash = magicHash(message, "Bitcoin Signed Message:\n");

    // // Sign the message using NEAR MPC
    const payload = Array.from(msgHash);
    const result = await near.createAtlasSignedPayload(payload);
    
    const big_r = result.big_r.affine_point;
    const big_s = result.s.scalar;
    const recovery_id = parseInt(result.recovery_id) + 27;

    const r = big_r.slice(2).padStart(64, "0");
    const s = big_s.padStart(64, "0");

    const rawSignatureTemp = Buffer.from(r + s, "hex");

    // Create a 65 byte buffer with recovery_id + r + s
    const signature = Buffer.concat([
      Buffer.from([recovery_id]),
      rawSignatureTemp
    ]);

    return signature;
  }

  async getUtxosByTxid(depositAddress,txid) {
    try {
      const response = await axios.get(
        `${this.chain_rpc}/address/${depositAddress}/utxo`,
      );
      
      // Filter UTXOs by txid and transform to UtxoId format
      const utxos = response.data
        .filter(utxo => utxo.txid === txid)
        .map(utxo => ({
          txHash: utxo.txid,
          vout: utxo.vout
        }));

      return utxos;
    } catch (error) {
      console.error('Error fetching UTXOs by txid:', error.message);
      throw new Error(`Failed to get UTXOs for transaction ${txid}: ${error.message}`);
    }
  }

  async findSpendingTransaction(txid) {
    try {
      // Fetch the original transaction
      const txn = await this.fetchTxSpentByTxnID(txid);
      console.log("txn.vot: ", txn);

      if (txn.spent) {
        return txn.txid;
      }

      return "";
    } catch (error) {
      console.error('Error finding spending transaction:', error.message);
      throw new Error(`Failed to find spending transaction for ${txid}: ${error.message}`);
    }
  }

  // Encoding functions
  async encodeOpReturnData(message) {
    const messageRaw = {
        n: message.n,
        a: message.a,
        1: message[1],
        2: message[2],
        3: message[3],
    };
    const borshEncoded = borshSerialize(schema, messageRaw);
    return zlib.deflateSync(borshEncoded); // Further compress using zlib
  }

  // Decoding functions
  async decodeOpReturnData(buffer) {
    const decompressed = zlib.inflateSync(buffer); // Decompress first
    const messageRaw = borshDeserialize(schema, decompressed);
    return new OpReturnData({
        n: messageRaw.n,
        a: messageRaw.a,
        1: messageRaw[1],
        2: messageRaw[2],
        3: messageRaw[3],
    });
  }
}

module.exports = { Bitcoin };
