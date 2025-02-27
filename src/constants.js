let constants = {
  DEPOSIT_STATUS: {},
  REDEMPTION_STATUS: {},
  BRIDGING_STATUS: {},
  NETWORK_TYPE: {},
  EVENT_NAME: {
    BURN_REDEEM: "BurnRedeem",
    BURN_BRIDGE: "BurnBridge",
    MINT_DEPOSIT: "MintDeposit",
    MINT_BRIDGE: "MintBridge",
  },
  BITHIVE_STATUS: {
    DEPOSIT_CONFIRMED: "DepositConfirmed",
    DEPOSIT_CONFIRMED_INVALID: "DepositConfirmedInvalid",
    WITHDRAW_CONFIRMED: "WithdrawConfirmed",
  },
  ERR_MSG: { TIMEOUT: "TIMEOUT", TIMED_OUT: "TIMED OUT" },
};

// Function to fetch constants from the NEAR contract and populate the constants object
async function fetchAndSetConstants(near) {
  try {
    const fetchedConstants = await near.getConstants(); // Fetch constants from NEAR contract

    constants = {
      ...constants, // Keep other static properties
      DEPOSIT_STATUS: {
        BTC_PENDING_DEPOSIT_MEMPOOL:
          fetchedConstants.deposit_status.DEP_BTC_PENDING_MEMPOOL,
        BTC_DEPOSITED_INTO_ATLAS:
          fetchedConstants.deposit_status.DEP_BTC_DEPOSITED_INTO_ATLAS,
          BTC_PENDING_YIELD_PROVIDER_DEPOSIT:
          fetchedConstants.deposit_status.DEP_BTC_PENDING_YIELD_PROVIDER_DEPOSIT,
        BTC_YIELD_PROVIDER_DEPOSITED:
          fetchedConstants.deposit_status.DEP_BTC_YIELD_PROVIDER_DEPOSITED,
        BTC_PENDING_MINTED_INTO_ABTC:
          fetchedConstants.deposit_status.DEP_BTC_PENDING_MINTED_INTO_ABTC,
        BTC_MINTED_INTO_ABTC:
          fetchedConstants.deposit_status.DEP_BTC_MINTED_INTO_ABTC,
        DEP_BTC_REFUNDING: fetchedConstants.deposit_status.DEP_BTC_REFUNDING,
        DEP_BTC_REFUNDED: fetchedConstants.deposit_status.DEP_BTC_REFUNDED,
      },
      REDEMPTION_STATUS: {
        ABTC_BURNT: fetchedConstants.redemption_status.RED_ABTC_BURNT,
        BTC_PENDING_MEMPOOL_CONFIRMATION:
          fetchedConstants.redemption_status
            .RED_BTC_PENDING_MEMPOOL_CONFIRMATION,
        BTC_PENDING_REDEMPTION_FROM_ATLAS_TO_USER:
          fetchedConstants.redemption_status
            .RED_BTC_PENDING_REDEMPTION_FROM_ATLAS_TO_USER,
            BTC_PENDING_YIELD_PROVIDER_UNSTAKE:
            fetchedConstants.redemption_status
              .RED_BTC_PENDING_YIELD_PROVIDER_UNSTAKE,
          BTC_YIELD_PROVIDER_UNSTAKE_PROCESSING:
            fetchedConstants.redemption_status
              .RED_BTC_YIELD_PROVIDER_UNSTAKE_PROCESSING,
          BTC_YIELD_PROVIDER_UNSTAKED:
            fetchedConstants.redemption_status
              .RED_BTC_YIELD_PROVIDER_UNSTAKED,
          BTC_PENDING_YIELD_PROVIDER_WITHDRAW:
            fetchedConstants.redemption_status
            .RED_BTC_PENDING_YIELD_PROVIDER_WITHDRAW,
          BTC_YIELD_PROVIDER_WITHDRAWING:
            fetchedConstants.redemption_status
              .RED_BTC_YIELD_PROVIDER_WITHDRAWING,
        BTC_YIELD_PROVIDER_WITHDRAWN:
            fetchedConstants.redemption_status
              .RED_BTC_YIELD_PROVIDER_WITHDRAWN,
        BTC_REDEEMED_BACK_TO_USER:
          fetchedConstants.redemption_status.RED_BTC_REDEEMED_BACK_TO_USER,
      },
      BRIDGING_STATUS: {
        ABTC_PENDING_BURNT:
          fetchedConstants.bridging_status.BRG_ABTC_PENDING_BURNT,
        ABTC_BURNT: fetchedConstants.bridging_status.BRG_ABTC_BURNT,
        ABTC_PENDING_BRIDGE_FROM_ORIGIN_TO_DEST:
          fetchedConstants.bridging_status
            .BRG_ABTC_PENDING_BRIDGE_FROM_ORIGIN_TO_DEST,
        ABTC_MINTED_TO_DEST:
          fetchedConstants.bridging_status.BRG_ABTC_MINTED_TO_DEST,
        ABTC_PENDING_YIELD_PROVIDER_UNSTAKE:
          fetchedConstants.bridging_status.BRG_ABTC_PENDING_YIELD_PROVIDER_UNSTAKE,
        ABTC_YIELD_PROVIDER_UNSTAKE_PROCESSING:
          fetchedConstants.bridging_status.BRG_ABTC_YIELD_PROVIDER_UNSTAKE_PROCESSING,
        ABTC_YIELD_PROVIDER_UNSTAKED:
          fetchedConstants.bridging_status.BRG_ABTC_YIELD_PROVIDER_UNSTAKED,
        ABTC_PENDING_YIELD_PROVIDER_WITHDRAW:
          fetchedConstants.bridging_status.BRG_ABTC_PENDING_YIELD_PROVIDER_WITHDRAW,
        ABTC_YIELD_PROVIDER_WITHDRAWING:
          fetchedConstants.bridging_status.BRG_ABTC_YIELD_PROVIDER_WITHDRAWING,
        ABTC_YIELD_PROVIDER_WITHDRAWN:
          fetchedConstants.bridging_status.BRG_ABTC_YIELD_PROVIDER_WITHDRAWN,
      },
      // Add network_type from the fetched constants
      NETWORK_TYPE: {
        TESTNET4: fetchedConstants.network_type.TESTNET4,
        SIGNET: fetchedConstants.network_type.SIGNET,
        BITCOIN: fetchedConstants.network_type.BITCOIN,
        EVM: fetchedConstants.network_type.EVM,
        NEAR: fetchedConstants.network_type.NEAR,
      },
      DELIMITER: {
        COMMA: fetchedConstants.delimiter.COMMA,
      },
      NEAR_GAS: {
        GAS_FOR_STORAGE_DEPOSIT: fetchedConstants.near_gas.GAS_FOR_STORAGE_DEPOSIT,
        MIN_STORAGE_DEPOSIT: fetchedConstants.near_gas.MIN_STORAGE_DEPOSIT,
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
