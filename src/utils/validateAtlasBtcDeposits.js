const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch } = require("./batchFlags");

// VALIDATOR BATCH FOR BTC DEPOSITS:
async function ValidateAtlasBtcDeposits(
  deposits,
  btcAtlasDepositAddress,
  near,
  bitcoin
) {
  const batchName = `Validator Batch ValidateAtlasBtcDeposits`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcDepositsRunning) {
    //console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcDepositsRunning = true;

      // Retrieve constants and validators_threshold
      const { DEPOSIT_STATUS, NETWORK_TYPE } = getConstants(); // Access constants dynamically
      //console.log(DEPOSIT_STATUS);
      //console.log(NETWORK_TYPE);

      const chainConfig = getChainConfig(NETWORK_TYPE.SIGNET);

      let validatorThreshold = chainConfig.validators_threshold;
      //console.log(`validatorThreshold: ${validatorThreshold}`);
      //console.log(DEPOSIT_STATUS.BTC_DEPOSITED_INTO_ATLAS);
      //console.log(deposits);

      // Retrieve all NEAR deposit records with status = BTC_DEPOSITED_INTO_ATLAS and verified_count < chain_id.validators_threshold
      const allDepositsToValidate = deposits.filter(
        (deposit) =>
          deposit.status === DEPOSIT_STATUS.BTC_DEPOSITED_INTO_ATLAS &&
          deposit.remarks === "" &&
          deposit.verified_count < validatorThreshold
      );
      //console.log(`allDepositsToValidate.length: ${allDepositsToValidate.length}`);

      // For each NEAR deposit record, find respective bitcoin txn from bitcoin mempool with status = confirmed and prepare a mempool_deposit record to pass into NEAR function
      for (const nearTxn of allDepositsToValidate) {
        let btcMempoolTxn = await bitcoin.fetchTxnByTxnID(nearTxn.btc_txn_hash);
        //console.log(btcMempoolTxn);

        let btcSenderAddress = await bitcoin.getBtcSenderAddress(btcMempoolTxn);
        let {
          chain: receivingChainID,
          address: receivingAddress,
          remarks: remarks,
        } = await bitcoin.getChainAndAddressFromTxnHash(btcMempoolTxn);
        let btcAmount = 0;
        let mintedTxnHash = "";

        // get btc amount if there are values for both receivingChainID and receivingAddress
        if (receivingChainID && receivingAddress) {
          btcAmount = await bitcoin.getBtcReceivingAmount(
            btcMempoolTxn,
            btcAtlasDepositAddress
          );
        }

        let btcStatus = 0;
        if (btcMempoolTxn.status.confirmed) {
          btcStatus = DEPOSIT_STATUS.BTC_DEPOSITED_INTO_ATLAS;
        }

        // Create the DepositRecord object
        const btcMempoolDepositRecord = {
          btc_txn_hash: btcMempoolTxn.txid,
          btc_sender_address: btcSenderAddress,
          receiving_chain_id: receivingChainID,
          receiving_address: receivingAddress,
          btc_amount: btcAmount + nearTxn.fee_amount,
          fee_amount: nearTxn.fee_amount,
          minted_txn_hash: mintedTxnHash,
          timestamp: btcMempoolTxn.status.block_time,
          status: btcStatus,
          remarks: remarks,
          date_created: btcMempoolTxn.status.block_time, // this field not used in validation
          verified_count: 0, // this field not used in validation
          retry_count: 0,
          minted_txn_hash_verified_count: 0, // this field not used in validation
          custody_txn_id: "",
        };
        console.log(btcMempoolDepositRecord);

        let blnValidated = await near.incrementDepositVerifiedCount(
          btcMempoolDepositRecord
        );

        if (blnValidated) {
          console.log(`BTC Txn Hash ${btcMempoolTxn.txid} Validated.`);
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
    } finally {
      flagsBatch.ValidateAtlasBtcDepositsRunning = false;
    }
  }
}

async function ValidateAtlasBtcDepositsMintedTxnHash(deposits, near) {
  const batchName = `Validator Batch ValidateAtlasBtcDepositsMintedTxnHash`;

  if (flagsBatch.ValidateAtlasBtcDepositsMintedTxnHashRunning) {
    console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcDepositsMintedTxnHashRunning = true;

      const { DEPOSIT_STATUS, NETWORK_TYPE } = getConstants();
      const allDepositsToValidate = deposits.filter((deposit) => {
        const chainConfig = getChainConfig(deposit.receiving_chain_id);
        const validatorThreshold = chainConfig.validators_threshold;
        return (
          deposit.status === DEPOSIT_STATUS.BTC_PENDING_MINTED_INTO_ABTC &&
          deposit.remarks === "" &&
          deposit.minted_txn_hash_verified_count < validatorThreshold &&
          deposit.minted_txn_hash
        );
      });

      if (allDepositsToValidate.length === 0) {
        console.log("No deposits to validate.");
        return;
      }

      // Find the earliest timestamp in the deposits
      const earliestTimestamp = Math.min(
        ...allDepositsToValidate.map((deposit) => deposit.timestamp)
      );

      for (const deposit of allDepositsToValidate) {
        const chainConfig = getChainConfig(deposit.receiving_chain_id);
        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
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
          const batchSize = chainConfig.batchSize;

          const events = await ethereum.getPastMintEventsInBatches(
            startBlock,
            endBlock,
            batchSize
          );

          const matchingEvent = events.find(
            (event) => event.returnValues.btcTxnHash === deposit.btc_txn_hash
          );

          if (matchingEvent) {
            const { transactionHash } = matchingEvent;
            const { btcTxnHash } = matchingEvent.returnValues;
            let blnValidated =
              await near.incrementDepositMintedTxnHashVerifiedCount(
                btcTxnHash,
                transactionHash
              );

            if (blnValidated) {
              console.log(
                `BTC Txn Hash ${btcTxnHash} with Minted Txn Hash ${transactionHash} on chain ID ${deposit.receiving_chain_id} Validated.`
              );
            }
          }
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          const startBlock = await near.getBlockNumberByTimestamp(
            earliestTimestamp
          );
          const endBlock = await near.getCurrentBlockNumber();

          const events = await near.getPastMintEventsInBatches(
            startBlock,
            endBlock
          );

          const matchingEvent = events.find(
            (event) => event.btcTxnHash === deposit.btc_txn_hash
          );

          if (matchingEvent) {
            const { transactionHash } = matchingEvent;
            const { btcTxnHash } = matchingEvent.returnValues;
            let blnValidated =
              await near.incrementDepositMintedTxnHashVerifiedCount(
                btcTxnHash,
                transactionHash
              );

            if (blnValidated) {
              console.log(
                `BTC Txn Hash ${btcTxnHash} with Minted Txn Hash ${transactionHash} on chain ID ${deposit.receiving_chain_id} Validated.`
              );
            }
          }
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
    } finally {
      flagsBatch.ValidateAtlasBtcDepositsMintedTxnHashRunning = false;
    }
  }
}

module.exports = {
  ValidateAtlasBtcDeposits,
  ValidateAtlasBtcDepositsMintedTxnHash,
};
