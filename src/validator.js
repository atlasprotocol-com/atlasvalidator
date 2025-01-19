// src/validator.js

const {
  ValidateAtlasBtcDeposits,
} = require("./utils/validateAtlasBtcDeposits");
const {
  ValidateAtlasBtcRedemptions,
} = require("./utils/validateAtlasBtcRedemptions");
const {
  ValidateAtlasBtcBridgings,
} = require("./utils/validateAtlasBtcBridgings");
const { fetchAndSetChainConfigs } = require("./utils/network.chain.config");

const { fetchAndSetConstants } = require("./constants");

const { Near } = require("./services/near");
const { Bitcoin } = require("./services/bitcoin");

// Load configuration
const config = require(process.env.ATLAS_VALIDATOR_CONFIG ||
  "./config/config.json");

const nearConfig = config.near;
const btcConfig = config.bitcoin;

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
let bridgings = [];

// Function to poll Near Atlas deposit records
const getAllDepositHistory = async () => {
  try {
    deposits = await near.getAllDeposits();
    console.log(`Fetching deposits history: ${deposits.length}`);
  } catch (error) {
    console.error(`Failed to fetch deposit history: ${error.message}`);
  }
};

// Function to poll Near Atlas redemption records
const getAllRedemptionHistory = async () => {
  try {
    redemptions = await near.getAllRedemptions();
    console.log(`Fetching redemptions history: ${redemptions.length}`);
  } catch (error) {
    console.error(`Failed to fetch redemption history: ${error.message}`);
  }
};

// Function to poll Btc mempool records
const getBtcMempoolRecords = async () => {
  try {
    btcMempool = await bitcoin.fetchTxnsByAddress(
      btcConfig.btcAtlasDepositAddress
    );
    console.log(`Fetching mempool records: ${btcMempool.data.length}`);
  } catch (error) {
    console.error(`Failed to fetch Btc Mempool records: ${error.message}`);
  }
};

// Function to poll Near Atlas bridging records
const getAllBridgingHistory = async () => {
  try {
    bridgings = await near.getAllBridgings();
    console.log(`Fetching bridging history: ${bridgings.length}`);
  } catch (error) {
    console.error(`Failed to fetch bridging history: ${error.message}`);
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
      await getAllBridgingHistory();

      // Validate deposits
      await ValidateAtlasBtcDeposits(
        deposits,
        btcConfig.btcAtlasDepositAddress,
        near,
        bitcoin
      );

      // Validate redemptions
      await ValidateAtlasBtcRedemptions(redemptions, near);

      // Validate bridgings
      await ValidateAtlasBtcBridgings(bridgings, near);

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
