const { Web3 } = require("web3");

const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");
const { sendErrorEmail } = require("./emailService");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch, blockRange } = require("./batchFlags");
const config = require('../config/config.json');

// Helper function to sleep for specified milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Constants for batch processing
const RECORDS_BEFORE_PAUSE = 10;
const PAUSE_DURATION_MS = 60000; // 1 minute in milliseconds

async function ValidateAtlasBtcRedemptions(redemptions, near) {
  const batchName = `Validator Batch ValidateAtlasBtcRedemptions`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcRedemptionsRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      // Retrieve constants and validators_threshold
      const { REDEMPTION_STATUS, NETWORK_TYPE, DELIMITER, EVENT_NAME } =
        getConstants(); // Access constants dynamically

      const filteredTxns = redemptions.filter((redemption) => {
        const chainConfig = getChainConfig(redemption.abtc_redemption_chain_id);
        const validatorThreshold = chainConfig.validators_threshold;
        return (
          redemption.status === REDEMPTION_STATUS.ABTC_BURNT &&
          redemption.remarks === "" &&
          redemption.verified_count < validatorThreshold
        );
      });

      console.log(
        "[validateAtlasBtcRedemptions] records to validate: ",
        filteredTxns.length
      );

      let processedCount = 0;

      for (const redemption of filteredTxns) {
        processedCount++;
        
        // Pause after processing RECORDS_BEFORE_PAUSE records
        if (processedCount % RECORDS_BEFORE_PAUSE === 0) {
          console.log(`Processed ${processedCount} records. Pausing for ${PAUSE_DURATION_MS/1000} seconds...`);
          await sleep(PAUSE_DURATION_MS);
        }

        const validatorsByTxnHash = await near.getValidatorsByTxnHash(redemption.txn_hash);

        if (validatorsByTxnHash.includes(config.near.accountId)) {
          console.log(redemption);
          console.log("[ValidateAtlasBtcRedemptions] Current validator has already validated this redemption with txn_hash:", redemption.txn_hash);
          continue;
        }

        // const hasVerified = await near.hasCallerVerifiedRedemptionTxnHash(redemption.txn_hash);
        // if (hasVerified) {
        //   console.log("[validateAtlasBtcRedemptions] Caller has already verified this redemption");
        //   continue;
        // }
        const chainConfig = getChainConfig(redemption.abtc_redemption_chain_id);
        const redemptionTxnHash = redemption.txn_hash;
        console.log("redemptionTxnHash: ", redemptionTxnHash);
        const onChainHash = redemptionTxnHash.split(DELIMITER.COMMA)[1];
        console.log("onChainHash: ", onChainHash);
        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
          try {
            const ethereum = new Ethereum(
              chainConfig.chainID,
              chainConfig.chainRpcUrl,
              chainConfig.gasLimit,
              chainConfig.aBTCAddress,
              chainConfig.abiPath
            );

            const timestamp = Math.floor(Date.now() / 1000);
            const evmStatus = REDEMPTION_STATUS.ABTC_BURNT;

            console.log(`Validating EVM transaction: ${onChainHash}`);
            const txReceipt = await ethereum.fetchEventByTxnHashAndEventName(
              onChainHash,
              EVENT_NAME.BURN_REDEEM
            );
            //console.log("txReceipt: ", txReceipt);
            if (!txReceipt) {
              console.log("Transaction receipt not found");
              continue;
            }

            // Create the redemptionRecord object
            const record = {
              txn_hash: redemptionTxnHash,
              abtc_redemption_address: txReceipt.returnValues.wallet,
              abtc_redemption_chain_id: chainConfig.chainID,
              btc_receiving_address: txReceipt.returnValues.btcAddress,
              abtc_amount: Number(txReceipt.returnValues.amount),
              protocol_fee: 0,
              btc_txn_hash: "", // this field not used in validation
              btc_redemption_fee: 0,
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0,
              yield_provider_gas_fee: 0,
              yield_provider_txn_hash: "",
              btc_txn_hash_verified_count: 0,
            };

            let blnValidated = await near.incrementRedemptionVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${redemptionTxnHash} -> ${blnValidated}`
            );
          } catch (error) {
            console.error(`Error validating NEAR transaction: ${error}`);
            await sendErrorEmail(error, batchName);
            continue;
          }
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          try {
            const timestamp = Math.floor(Date.now() / 1000);
            const evmStatus = REDEMPTION_STATUS.ABTC_BURNT;

            console.log(`Validating NEAR transaction: ${onChainHash}`);
            const txResult = await near.provider.txStatus(
              onChainHash,
              near.contract_id
            );

            // Get first receipt from transaction result
            const receipt = txResult.receipts_outcome[0];

            // Find first event log
            const eventLog = receipt.outcome.logs[0];
            if (!eventLog) {
              console.log("No event logs found");
              continue;
            }

            // Parse event JSON
            const eventJson = JSON.parse(eventLog.replace("EVENT_JSON:", ""));

            // Process event based on type
            const redeemMemo = JSON.parse(eventJson.data[0].memo);

            // Create the redemptionRecord object
            const record = {
              txn_hash: redemptionTxnHash,
              abtc_redemption_address: redeemMemo.address,
              abtc_redemption_chain_id: chainConfig.chainID,
              btc_receiving_address: redeemMemo.btcAddress,
              abtc_amount: Number(eventJson.data[0].amount),
              protocol_fee: 0,
              btc_txn_hash: "", // this field not used in validation
              btc_redemption_fee: 0,
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0,
              yield_provider_gas_fee: 0,
              yield_provider_txn_hash: "",
              btc_txn_hash_verified_count: 0,
            };

            let blnValidated = await near.incrementRedemptionVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${redemptionTxnHash} -> ${blnValidated}`
            );
          } catch (error) {
            console.error(`Error ${batchName}:`, error);
            await sendErrorEmail(error, batchName);
            continue;
          }
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
      await sendErrorEmail(error, batchName);
    } finally {
      flagsBatch.ValidateAtlasBtcRedemptionsRunning = false;
    }
  }
}

async function ValidateAtlasBtcRedemptionsBtcTxnHash(
  redemptions,
  near,
  bitcoin
) {
  const batchName = `Validator Batch ValidateAtlasBtcRedemptionsBtcTxnHash`;

  if (flagsBatch.ValidateAtlasBtcRedemptionsBtcTxnHashRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcRedemptionsBtcTxnHashRunning = true;

      const isProductionMode = await near.isProductionMode();
      const { REDEMPTION_STATUS, NETWORK_TYPE } = getConstants();
      const chainConfig = getChainConfig(
        isProductionMode ? NETWORK_TYPE.BITCOIN : NETWORK_TYPE.TESTNET4
      );
      let validatorThreshold = chainConfig.validators_threshold;

      const allRedemptionsToValidate = redemptions.filter(
        (redemption) =>
          redemption.status ===
            REDEMPTION_STATUS.BTC_PENDING_MEMPOOL_CONFIRMATION &&
          redemption.btc_txn_hash !== "" &&
          redemption.remarks === "" &&
          redemption.btc_txn_hash_verified_count < validatorThreshold
      );

      let processedCount = 0;

      for (const redemption of allRedemptionsToValidate) {

        processedCount++;
        
        // Pause after processing RECORDS_BEFORE_PAUSE records
        if (processedCount % RECORDS_BEFORE_PAUSE === 0) {
          console.log(`Processed ${processedCount} records. Pausing for ${PAUSE_DURATION_MS/1000} seconds...`);
          await sleep(PAUSE_DURATION_MS);
        }

        const validatorsByTxnHash = await near.getValidatorsByTxnHash(redemption.txn_hash + DELIMITER.COMMA + redemption.btc_txn_hash);

        if (validatorsByTxnHash.includes(config.near.accountId)) {
          console.log("[ValidateAtlasBtcRedemptionsBtcTxnHash] Current validator has already validated this redemption btc txn hash");
          continue;
        }

        let btcMempoolRecord;

        try{
          btcMempoolRecord = await bitcoin.fetchTxnByTxnID(nearTxn.btc_txn_hash);
        } catch {
          console.error(`Error ${batchName}:`, error);
          await sendErrorEmail(error, batchName);
        }
        

        if (btcMempoolRecord) {
          const { txid } = btcMempoolRecord;
          try {
            const blnValidated =
              await near.incrementRedemptionBtcTxnHashVerifiedCount(
                redemption.txn_hash,
                txid
              );

            if (blnValidated) {
              console.log(`BTC Txn Hash ${txid} validated.`);
            }
          } catch (error) {
            console.error(`Error validating NEAR transaction: ${error}`);
            await sendErrorEmail(error, batchName);
            continue;
          }
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
      await sendErrorEmail(error, batchName);
    } finally {
      flagsBatch.ValidateAtlasBtcRedemptionsBtcTxnHashRunning = false;
    }
  }
}

module.exports = {
  ValidateAtlasBtcRedemptions,
  ValidateAtlasBtcRedemptionsBtcTxnHash,
};
