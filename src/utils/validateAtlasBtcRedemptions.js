const { Web3 } = require("web3");

const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");
const { sendErrorEmail } = require("./emailService");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch, blockRange } = require("./batchFlags");

async function ValidateAtlasBtcRedemptions(redemptions, near) {
  const batchName = `Validator Batch ValidateAtlasBtcRedemptions`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcRedemptionsRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      // Retrieve constants and validators_threshold
      const { REDEMPTION_STATUS, NETWORK_TYPE, DELIMITER, EVENT_NAME } = getConstants(); // Access constants dynamically

      const filteredTxns = redemptions.filter(
        (redemption) =>
          redemption.status === REDEMPTION_STATUS.ABTC_BURNT &&
          redemption.remarks === ""
      );

      for (const redemption of filteredTxns) {
        const chainID = redemption.abtc_redemption_chain_id;
        const chainConfig = getChainConfig(chainID);
        let validatorThreshold = chainConfig.validators_threshold;
        console.log("validatorThreshold: ", validatorThreshold);
        console.log("redemption.verified_count: ", redemption.verified_count);
        if (redemption.verified_count >= validatorThreshold) continue;

        const redemptionTxnHash = redemption.txn_hash;
        console.log("redemptionTxnHash: ", redemptionTxnHash);
        const onChainHash = redemptionTxnHash.split(DELIMITER.COMMA)[1];
        console.log("onChainHash: ", onChainHash);
        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
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
          const txReceipt = await ethereum.fetchEventByTxnHashAndEventName(onChainHash, EVENT_NAME.BURN_REDEEM);
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
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          
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
  btcMempool,
  near
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

      for (const redemption of allRedemptionsToValidate) {
        const btcMempoolRecord = btcMempool?.data?.find?.(
          (record) => record.txid === redemption.btc_txn_hash
        );

        if (btcMempoolRecord) {
          const { txid } = btcMempoolRecord;
          const blnValidated =
            await near.incrementRedemptionBtcTxnHashVerifiedCount(
              redemption.txn_hash,
              txid
            );

          if (blnValidated) {
            console.log(`BTC Txn Hash ${txid} validated.`);
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
