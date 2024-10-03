let constants = {
  DEPOSIT_STATUS: {},
  REDEMPTION_STATUS: {},
  BRIDGING_STATUS: {},  
  NETWORK_TYPE: {},
  EVENT_NAME: { BURN_REDEEM: "BurnRedeem", BURN_BRIDGE: "BurnBridge", MINT_DEPOSIT: "MintDeposit" },
  ERR_MSG: { TIMEOUT: "TIMEOUT", TIMED_OUT: "TIMED OUT" },  
};

// Function to fetch constants from the NEAR contract and populate the constants object
async function fetchAndSetConstants(near) {
  try {
    const fetchedConstants = await near.getConstants(); // Fetch constants from NEAR contract

    constants = {
      ...constants, // Keep other static properties
      DEPOSIT_STATUS: {
        BTC_PENDING_DEPOSIT_MEMPOOL: fetchedConstants.deposit_status.DEP_BTC_PENDING_MEMPOOL,
        BTC_DEPOSITED_INTO_ATLAS: fetchedConstants.deposit_status.DEP_BTC_DEPOSITED_INTO_ATLAS,
        BTC_PENDING_DEPOSIT_INTO_BABYLON: fetchedConstants.deposit_status.DEP_BTC_PENDING_DEPOSIT_INTO_BABYLON,
        BTC_DEPOSITED_INTO_BABYLON: fetchedConstants.deposit_status.DEP_BTC_DEPOSITED_INTO_BABYLON,
        BTC_PENDING_MINTED_INTO_ABTC: fetchedConstants.deposit_status.DEP_BTC_PENDING_MINTED_INTO_ABTC,
        BTC_MINTED_INTO_ABTC: fetchedConstants.deposit_status.DEP_BTC_MINTED_INTO_ABTC,
      },
      REDEMPTION_STATUS: {
        ABTC_BURNT: fetchedConstants.redemption_status.RED_ABTC_BURNT,
        BTC_PENDING_MEMPOOL_CONFIRMATION: fetchedConstants.redemption_status.RED_BTC_PENDING_MEMPOOL_CONFIRMATION,
        BTC_PENDING_REDEMPTION_FROM_ATLAS_TO_USER: fetchedConstants.redemption_status.RED_BTC_PENDING_REDEMPTION_FROM_ATLAS_TO_USER,
        BTC_PENDING_REDEMPTION_FROM_BABYLON_TO_ATLAS: fetchedConstants.redemption_status.RED_BTC_PENDING_REDEMPTION_FROM_BABYLON_TO_ATLAS,
        BTC_REDEEMED_FROM_BABYLON_INTO_ATLAS: fetchedConstants.redemption_status.RED_BTC_REDEEMED_FROM_BABYLON_INTO_ATLAS,
        BTC_REDEEMED_BACK_TO_USER: fetchedConstants.redemption_status.RED_BTC_REDEEMED_BACK_TO_USER,
      },
      BRIDGING_STATUS: {
        ABTC_BURNT: fetchedConstants.bridging_status.BRG_ABTC_BURNT,
        ABTC_PENDING_BRIDGE_FROM_ORIGIN_TO_DEST: fetchedConstants.bridging_status.BRG_ABTC_PENDING_BRIDGE_FROM_ORIGIN_TO_DEST,
        ABTC_MINTED_TO_DEST: fetchedConstants.bridging_status.BRG_ABTC_MINTED_TO_DEST,        
      },
      // Add network_type from the fetched constants
      NETWORK_TYPE: {
        SIGNET: fetchedConstants.network_type.SIGNET,
        BITCOIN: fetchedConstants.network_type.BITCOIN,
        EVM: fetchedConstants.network_type.EVM,
        NEAR: fetchedConstants.network_type.NEAR,
      },
      DELIMITER: { 
        COMMA: fetchedConstants.delimiter.COMMA,
      },
    };

    console.log("Constants loaded successfully:", constants);
  } catch (error) {
    console.error("Error fetching constants:", error);
  }
}

// Function to get the constants
function getConstants() {
  return constants;
}

module.exports = {
  fetchAndSetConstants,
  getConstants,
};
