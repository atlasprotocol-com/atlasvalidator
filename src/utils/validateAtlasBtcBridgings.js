const { getConstants } = require("../constants");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch, blockRange } = require("./batchFlags");
const config = require('../config/config.json');
const { sendErrorEmail } = require("./emailService");

const { Web3 } = require("web3");
const { Ethereum } = require("../services/ethereum");

// VALIDATOR BATCH FOR aBTC BRIDGINGS:
// 1. Retrieve all NEAR bridging records with status = RED_ABTC_BURNT and verified_count < chain_id.validators_threshold
// 2. For each NEAR bridging record, find BurnBridge event from respective origin_chain_id and prepare a mempool_bridging record to pass into NEAR function
// 3. Call NEAR function increment_bridging_verified_count by passing in the mempool_bridging record
// 4. TO DISCUSS: If validator_threshold gets updated suddenly, will this introduce any bugs?
// 5. TO DISCUSS: Cannot delete verifications records else we are not able to allocate the airdrop
// 6. TO DISCUSS: How to prevent authorised validators to directly call the public NEAR function increment_bridging_verified_count without going through this server.js function?

// Helper function to sleep for specified milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Constants for batch processing
const RECORDS_BEFORE_PAUSE = 10;
const PAUSE_DURATION_MS = 60000; // 1 minute in milliseconds

async function ValidateAtlasBtcBridgings(bridgings, near) {
  const batchName = `Validator Batch ValidateAtlasBtcBridgings`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcBridgingsRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcBridgingsRunning = true;

      // Retrieve constants and validators_threshold
      const { BRIDGING_STATUS, NETWORK_TYPE, DELIMITER, EVENT_NAME } = getConstants(); // Access constants dynamically

      const filteredTxns = bridgings.filter((bridging) => {
        const chainConfig = getChainConfig(bridging.origin_chain_id);
        const validatorThreshold = chainConfig.validators_threshold;
        return (
          bridging.status === BRIDGING_STATUS.ABTC_BURNT &&
          bridging.remarks === "" &&
          bridging.verified_count < validatorThreshold
        );
      });

      for (let i = 0; i < filteredTxns.length; i++) {

        const bridging = filteredTxns[i];
        const chainConfig = getChainConfig(bridging.origin_chain_id);

        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
          const web3 = new Web3(chainConfig.chainRpcUrl);
          const ethereum = new Ethereum(
            chainConfig.chainID,
            chainConfig.chainRpcUrl,
            chainConfig.gasLimit,
            chainConfig.aBTCAddress,
            chainConfig.abiPath
          );
          const matchingEvent = await ethereum.fetchEventByTxnHashAndEventName(bridging.txn_hash.split(DELIMITER.COMMA)[1], EVENT_NAME.BURN_BRIDGE);
          
          console.log(matchingEvent);
          
          const {
            returnValues: {
              wallet,
              destChainId,
              destChainAddress,
              amount,
              protocolFee,
              mintingFeeSat,
              bridgingFeeSat,
            },
            transactionHash,
            blockNumber,
          } = matchingEvent; // Make sure blockNumber is part of the event object

          let bridgingTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;
          let timestamp = Math.floor(Date.now() / 1000);

          // Create the BridgingRecord object
          const record = {
            txn_hash: bridgingTxnHash,
            origin_chain_id: chainConfig.chainID,
            origin_chain_address: wallet,
            dest_chain_id: destChainId,
            dest_chain_address: destChainAddress,
            dest_txn_hash: "", // this field not used in validation
            abtc_amount: Number(amount),
            protocol_fee: Number(protocolFee || 0),
            timestamp: timestamp,
            status: BRIDGING_STATUS.ABTC_BURNT,
            remarks: "",
            date_created: timestamp, // this field not used in validation
            verified_count: 0, // this field not used in validation
            minting_fee_sat: Number(mintingFeeSat),
            bridging_gas_fee_sat: Number(bridgingFeeSat),
            actual_gas_fee_sat: 0,
            yield_provider_gas_fee: 0,
            yield_provider_txn_hash: "",
            yield_provider_status: BRIDGING_STATUS.ABTC_BURNT,
            yield_provider_remarks: "",
            treasury_btc_txn_hash: "",
            treasury_verified_count: 0,
            minted_txn_hash_verified_count: 0,
          };
          let blnValidated = await near.incrementBridgingVerifiedCount(
            record
          );

          console.log(
            `${batchName}: Validating ${bridgingTxnHash} -> ${blnValidated}`
          );
          
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          try {
            const timestamp = Math.floor(Date.now() / 1000);
            const evmStatus = BRIDGING_STATUS.ABTC_BURNT;

            console.log(`Validating NEAR transaction: ${bridging.txn_hash.split(DELIMITER.COMMA)[1]}`);
            const txResult = await near.provider.txStatus(
              bridging.txn_hash.split(DELIMITER.COMMA)[1],
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
            const bridgeMemo = JSON.parse(eventJson.data[0].memo);

            // Create the BridgingRecord object
            const record = {
              txn_hash: bridging.txn_hash,
              origin_chain_id: chainConfig.chainID,
              origin_chain_address: bridgeMemo.address,
              dest_chain_id: bridgeMemo.destChainId,
              dest_chain_address: bridgeMemo.destChainAddress,
              dest_txn_hash: "", // this field not used in validation
              abtc_amount: Number(eventJson.data[0].amount),
              protocol_fee: 0,
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0, // this field not used in validation
              minting_fee_sat: 0,
              bridging_gas_fee_sat: 0,
              actual_gas_fee_sat: 0,
              yield_provider_gas_fee: 0,
              yield_provider_txn_hash: "",
              yield_provider_status: evmStatus,
              yield_provider_remarks: "",
              treasury_btc_txn_hash: "",
              treasury_verified_count: 0,
              minted_txn_hash_verified_count: 0,
            };

            let blnValidated = await near.incrementBridgingVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${bridging.txn_hash} -> ${blnValidated}`
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
    } finally {
      flagsBatch.ValidateAtlasBtcBridgingsRunning = false;
    }
  }
}

async function ValidateAtlasBtcBridgingsMintedTxnHash(bridgings, near) {
  const batchName = `Validator Batch ValidateAtlasBtcBridgingsMintedTxnHash`;

  if (flagsBatch.ValidateAtlasBtcBridgingsMintedTxnHashRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcBridgingsMintedTxnHashRunning = true;

      const { BRIDGING_STATUS, NETWORK_TYPE, DELIMITER, EVENT_NAME } = getConstants(); // Access constants dynamically

      const allBridgingsToValidate = bridgings.filter(
        (bridging) =>
          bridging.status === BRIDGING_STATUS.ABTC_PENDING_BRIDGE_FROM_ORIGIN_TO_DEST &&
          bridging.dest_txn_hash !== "" &&
          bridging.remarks === "" &&
          bridging.minted_txn_hash_verified_count < getChainConfig(bridging.dest_chain_id).validators_threshold
      );

      let processedCount = 0;

      for (const bridging of allBridgingsToValidate) {
        processedCount++;
        
        // Pause after processing RECORDS_BEFORE_PAUSE records
        if (processedCount % RECORDS_BEFORE_PAUSE === 0) {
          console.log(`Processed ${processedCount} records. Pausing for ${PAUSE_DURATION_MS/1000} seconds...`);
          await sleep(PAUSE_DURATION_MS);
        }

        const validatorsByTxnHash = await near.getValidatorsByTxnHash(bridging.txn_hash + DELIMITER.COMMA + bridging.dest_txn_hash);

        if (validatorsByTxnHash.includes(config.near.accountId)) {
          console.log("[ValidateAtlasBtcBridgingsMintedTxnHash] Current validator has already validated this bridging minted txn hash");
          continue;
        }

        const chainConfig = getChainConfig(bridging.dest_chain_id);
        let mintedTxnRecord;

        try {
          if (chainConfig.networkType === NETWORK_TYPE.EVM) {
            const ethereum = new Ethereum(
              chainConfig.chainID,
              chainConfig.chainRpcUrl,
              chainConfig.gasLimit,
              chainConfig.aBTCAddress,
              chainConfig.abiPath
            );
            mintedTxnRecord = await ethereum.fetchEventByTxnHashAndEventName(
              bridging.dest_txn_hash,
              EVENT_NAME.MINT_BRIDGE
            );
          } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
            mintedTxnRecord = await near.provider.txStatus(
              bridging.dest_txn_hash,
              near.contract_id
            );
          }

          if (mintedTxnRecord) {
            const blnValidated = await near.incrementBridgingMintedTxnHashVerifiedCount(
              bridging.txn_hash,
              bridging.dest_txn_hash
            );

            if (blnValidated) {
              console.log(`Minted Txn Hash ${bridging.dest_txn_hash} validated.`);
            }
          }
        } catch (error) {
          console.error(`Error validating minted transaction: ${error}`);
          await sendErrorEmail(error, batchName);
          continue;
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
      await sendErrorEmail(error, batchName);
    } finally {
      flagsBatch.ValidateAtlasBtcBridgingsMintedTxnHashRunning = false;
    }
  }
}

module.exports = { ValidateAtlasBtcBridgings, ValidateAtlasBtcBridgingsMintedTxnHash };
