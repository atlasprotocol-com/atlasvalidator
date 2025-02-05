// src/validator.js

const {
  ValidateAtlasBtcDeposits,
  ValidateAtlasBtcDepositsMintedTxnHash,
} = require("./utils/validateAtlasBtcDeposits");
const {
  ValidateAtlasBtcRedemptions,
  ValidateAtlasBtcRedemptionsBtcTxnHash,
} = require("./utils/validateAtlasBtcRedemptions");
const {
  fetchAndSetChainConfigs,
  getAllChainConfig,
} = require("./utils/network.chain.config");

const { fetchAndSetConstants, getConstants } = require("./constants");

const { Near } = require("./services/near");
const { Bitcoin } = require("./services/bitcoin");

// Load configuration
const config = require(process.env.ATLAS_VALIDATOR_CONFIG ||
  "./config/config.json");

const nearConfig = config.near;
const btcConfig = config.bitcoin;

const bttcDepositAddress =
  btcConfig.coboBtcDepositAddress || btcConfig.btcAtlasDepositAddress;

const near = new Near(
  nearConfig.nodeUrl,
  nearConfig.accountId,
  nearConfig.contractId,
  nearConfig.pk,
  nearConfig.networkId,
  nearConfig.gas,
  nearConfig.mpcContractId
);

const bitcoin = new Bitcoin(btcConfig.btcAPI, btcConfig.btcNetwork);

let deposits = [];
let redemptions = [];
let btcMempool = [];

// Function to poll Near Atlas deposit records
const getAllDepositHistory = async () => {
  try {
    console.log("Fetching deposits history");
    deposits = await near.getAllDeposits();
  } catch (error) {
    console.error(`Failed to fetch deposit history: ${error.message}`);
  }
};

// Function to poll Near Atlas redemption records
const getAllRedemptionHistory = async () => {
  try {
    console.log("Fetching redemptions history");
    redemptions = await near.getAllRedemptions();
  } catch (error) {
    console.error(`Failed to fetch redemption history: ${error.message}`);
  }
};

// Function to poll Btc mempool records
const getBtcMempoolRecords = async () => {
  try {
    console.log("Fetching Btc Mempool Records");
    btcMempool = await bitcoin.fetchTxnsByAddress(bttcDepositAddress);
  } catch (error) {
    console.error(`Failed to fetch Btc Mempool records: ${error.message}`);
  }
};

// One-time initialization function
async function initialize() {
  console.log("Initializing Near...");
  await near.init();
  await fetchAndSetChainConfigs(near);
  await fetchAndSetConstants(near); // Load constants
}

// Continuous validation function
async function continuousValidation() {
  while (true) {
    try {
      // Fetch data
      console.log("Starting a new validation cycle...");
      await getAllDepositHistory();
      await getAllRedemptionHistory();
      await getBtcMempoolRecords();

      // Validate deposits
      await ValidateAtlasBtcDeposits(
        deposits,
        bttcDepositAddress,
        near,
        bitcoin
      );

      // Validate minted transaction hashes
      await ValidateAtlasBtcDepositsMintedTxnHash(deposits, near);

      // Validate redemptions
      await ValidateAtlasBtcRedemptions(redemptions, near);

      // Validate BTC transaction hashes for redemptions
      await ValidateAtlasBtcRedemptionsBtcTxnHash(redemptions, btcMempool, near);

      // Sleep for a while before the next iteration
    } catch (error) {
      console.error("Validation cycle failed:", error);
    } finally {
      console.log("Validation cycle completed, sleeping for 10 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds delay
    }
  }
}

// Run the validation
async function runValidation() {
  try {
    await initialize(); // Run the one-time initialization
    await continuousValidation(); // Start the continuous validation loop
  } catch (error) {
    console.error("Validation failed:", error);
  }
}

// Start the validation process
runValidation()
  .then(() => {
    console.log("Validation process started");
  })
  .catch((error) => {
    console.error("Validation process encountered an error:", error);
  });
