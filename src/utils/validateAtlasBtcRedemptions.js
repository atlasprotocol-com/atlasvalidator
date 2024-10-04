const { Web3 } = require("web3");

const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch } = require("./batchFlags");

async function ValidateAtlasBtcRedemptions(redemptions, near) {
  const batchName = `Validator Batch ValidateAtlasBtcRedemptions`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcRedemptionsRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      // Retrieve constants and validators_threshold
      const { REDEMPTION_STATUS, NETWORK_TYPE, DELIMITER } = getConstants(); // Access constants dynamically

      const filteredTxns = redemptions.filter(
        (redemption) =>
          redemption.status === REDEMPTION_STATUS.ABTC_BURNT &&
          redemption.remarks === ""
      );

      const groupedTxns = filteredTxns.reduce((acc, redemption) => {
        if (!acc[redemption.abtc_redemption_chain_id]) {
          acc[redemption.abtc_redemption_chain_id] = [];
        }
        acc[redemption.abtc_redemption_chain_id].push(redemption);
        return acc;
      }, {});

      for (let chainID in groupedTxns) {
        const chainConfig = getChainConfig(chainID);
        let validatorThreshold = chainConfig.validators_threshold;
        const redemptions = groupedTxns[chainID].filter(
          (redemption) => redemption.verified_count < validatorThreshold
        );
        if (redemptions.length === 0) continue;

        // Find the earliest timestamp in the redemptions for this chain
        const earliestTimestamp = Math.min(
          ...redemptions.map((redemption) => redemption.timestamp)
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

          const endBlock = await ethereum.getCurrentBlockNumber();
          const events = await ethereum.getPastBurnEventsInBatches(
            startBlock,
            endBlock,
            chainConfig.batchSize
          );

          console.log(
            `${chainConfig.networkName}: Found ${events.length} Burn events`
          );

          for (const event of events) {
            const {
              returnValues: { wallet, btcAddress, amount },
              transactionHash,
              blockNumber,
            } = event; // Make sure blockNumber is part of the event object

            const block = await web3.eth.getBlock(blockNumber);
            let redemptionTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;
            let timestamp = Number(block.timestamp);

            // Fetch the transaction receipt to check the status
            const receipt = await web3.eth.getTransactionReceipt(
              transactionHash
            );
            let evmStatus = 0;
            if (receipt.status) {
              evmStatus = REDEMPTION_STATUS.ABTC_BURNT;
            }

            // Create the redemptionRecord object
            const record = {
              txn_hash: redemptionTxnHash,
              abtc_redemption_address: wallet,
              abtc_redemption_chain_id: chainConfig.chainID,
              btc_receiving_address: btcAddress,
              abtc_amount: Number(amount),
              btc_txn_hash: "", // this field not used in validation
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0,
              custody_txn_id: "",
            };

            let blnValidated = await near.incrementRedemptionVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${redemptionTxnHash} -> ${blnValidated}`
            );
          }
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          const startBlock = await near.getBlockNumberByTimestamp(
            earliestTimestamp
          );
          console.log("startBlock: " + startBlock);

          const currentBlock = await near.getCurrentBlockNumber();
          console.log("endBlock: " + currentBlock);

          const events = await near.getPastBurnRedemptionEventsInBatches(
            startBlock - 5,
            currentBlock,
            chainConfig.aBTCAddress
          );

          for (const event of events) {
            const {
              returnValues: { amount, wallet, btcAddress },
              transactionHash,
              timestamp,
              status,
            } = event; // Make sure blockNumber is part of the event object

            let redemptionTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;
            let evmStatus = 0;
            if (status) {
              evmStatus = REDEMPTION_STATUS.ABTC_BURNT;
            }

            // Create the redemptionRecord object
            const record = {
              txn_hash: redemptionTxnHash,
              abtc_redemption_address: wallet,
              abtc_redemption_chain_id: chainConfig.chainID,
              btc_receiving_address: btcAddress,
              abtc_amount: Number(amount),
              btc_txn_hash: "", // this field not used in validation
              timestamp: timestamp,
              status: evmStatus,
              remarks: "",
              date_created: timestamp, // this field not used in validation
              verified_count: 0,
              custody_txn_id: "",
            };

            let blnValidated = await near.incrementRedemptionVerifiedCount(
              record
            );

            console.log(
              `${batchName}: Validating ${redemptionTxnHash} -> ${blnValidated}`
            );
          }
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
    } finally {
      flagsBatch.ValidateAtlasBtcRedemptionsRunning = false;
    }
  }
}

module.exports = { ValidateAtlasBtcRedemptions };
