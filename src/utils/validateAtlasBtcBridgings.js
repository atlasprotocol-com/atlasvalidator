const { getConstants } = require("../constants");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch, blockRange } = require("./batchFlags");

const { Web3 } = require("web3");
const { Ethereum } = require("../services/ethereum");

// VALIDATOR BATCH FOR aBTC BRIDGINGS:
// 1. Retrieve all NEAR bridging records with status = RED_ABTC_BURNT and verified_count < chain_id.validators_threshold
// 2. For each NEAR bridging record, find BurnBridge event from respective origin_chain_id and prepare a mempool_bridging record to pass into NEAR function
// 3. Call NEAR function increment_bridging_verified_count by passing in the mempool_bridging record
// 4. TO DISCUSS: If validator_threshold gets updated suddenly, will this introduce any bugs?
// 5. TO DISCUSS: Cannot delete verifications records else we are not able to allocate the airdrop
// 6. TO DISCUSS: How to prevent authorised validators to directly call the public NEAR function increment_bridging_verified_count without going through this server.js function?
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
      const { BRIDGING_STATUS, NETWORK_TYPE, DELIMITER } = getConstants(); // Access constants dynamically

      const filteredTxns = bridgings.filter(
        (bridging) =>
          bridging.status === BRIDGING_STATUS.ABTC_BURNT &&
          bridging.remarks === ""
      );

      // Group bridgings by receiving_chain_id
      const groupedTxns = filteredTxns.reduce((acc, bridging) => {
        if (!acc[bridging.origin_chain_id]) {
          acc[bridging.origin_chain_id] = [];
        }
        acc[bridging.origin_chain_id].push(bridging);
        return acc;
      }, {});

      for (let chainID in groupedTxns) {
        const chainConfig = getChainConfig(chainID);
        let validatorThreshold = chainConfig.validators_threshold;
        const bridgings = groupedTxns[chainID].filter(
          (bridging) => bridging.verified_count < validatorThreshold
        );
        if (bridgings.length === 0) continue;

        // Find the earliest timestamp in the bridgings for this chain
        const earliestTimestamp = Math.min(
          ...bridgings.map((bridging) => bridging.timestamp)
        );

        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
          const web3 = new Web3(chainConfig.chainRpcUrl);
          const ethereum = new Ethereum(
            chainConfig.chainID,
            chainConfig.chainRpcUrl,
            chainConfig.gasLimit,
            chainConfig.aBTCAddress,
            chainConfig.abiPath
          );

          const startBlock = await ethereum.getBlockNumberByTimestamp(
            earliestTimestamp
          );
          const endBlock = Math.min(
            Number(await ethereum.getCurrentBlockNumber()),
            Number(startBlock + BigInt(500))
          );
          console.log(
            `${batchName}  chainID:${chainConfig.chainID} - startBlock: ${startBlock} endBlock:${endBlock}`
          );

          const events = await ethereum.getPastBurnBridgingEventsInBatches(
            startBlock - BigInt(100),
            endBlock,
            blockRange(Number(chainConfig.batchSize))
          );

          console.log(
            `${chainConfig.networkName}: Found ${events.length} Burn events`
          );

          for (const event of events) {
            const {
              returnValues: { wallet, destChainId, destChainAddress, amount },
              transactionHash,
              blockNumber,
            } = event; // Make sure blockNumber is part of the event object

            const block = await web3.eth.getBlock(blockNumber);
            let bridgingTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;
            let timestamp = Number(block.timestamp);

            // Fetch the transaction receipt to check the status
            const receipt = await web3.eth.getTransactionReceipt(
              transactionHash
            );
            let evmStatus = 0;
            if (receipt.status) {
              evmStatus = BRIDGING_STATUS.ABTC_BURNT;
            }

            // Create the BridgingRecord object
            const record = {
              txn_hash: bridgingTxnHash,
              origin_chain_id: chainConfig.chainID,
              origin_chain_address: wallet,
              dest_chain_id: destChainId,
              dest_chain_address: destChainAddress,
              dest_txn_hash: "", // this field not used in validation
              abtc_amount: Number(amount),
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0, // this field not used in validation
            };

            let blnValidated = await near.incrementBridgingVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${bridgingTxnHash} -> ${blnValidated}`
            );
          }
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          const startBlock = await near.getBlockNumberByTimestamp(
            earliestTimestamp
          );

          const endBlock = Math.min(
            Number(await near.getCurrentBlockNumber()),
            Number(startBlock + 500)
          );
          console.log(
            `${batchName}  chainID:${chainConfig.chainID} - startBlock: ${startBlock} endBlock:${endBlock}`
          );

          const events = await near.getPastBurnBridgingEventsInBatches(
            startBlock - 100,
            endBlock,
            chainConfig.aBTCAddress
          );

          for (const event of events) {
            const {
              returnValues: { wallet, destChainId, destChainAddress, amount },
              transactionHash,
              timestamp,
              status,
            } = event; // Make sure blockNumber is part of the event object

            let bridgingTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;
            let evmStatus = 0;
            if (status) {
              evmStatus = BRIDGING_STATUS.ABTC_BURNT;
            }

            // Create the BridgingRecord object
            const record = {
              txn_hash: bridgingTxnHash,
              origin_chain_id: chainConfig.chainID,
              origin_chain_address: wallet,
              dest_chain_id: destChainId,
              dest_chain_address: destChainAddress,
              dest_txn_hash: "", // this field not used in validation
              abtc_amount: Number(amount),
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0, // this field not used in validation
            };

            let blnValidated = await near.incrementBridgingVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${bridgingTxnHash} -> ${blnValidated}`
            );
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

module.exports = { ValidateAtlasBtcBridgings };
