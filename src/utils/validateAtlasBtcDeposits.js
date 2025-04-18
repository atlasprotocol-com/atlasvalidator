const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");
const { sendErrorEmail } = require("./emailService");

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

      const chainConfig = getChainConfig(NETWORK_TYPE.TESTNET4);

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
          yieldProviderGasFee,
          protocolFee,
          mintingFee,
        } = await bitcoin.getChainAndAddressFromTxnHash(btcMempoolTxn);
        let btcAmount = 0;
        let mintedTxnHash = "";

        // get btc amount if there are values for both receivingChainID and receivingAddress
        if (receivingChainID && receivingAddress) {
          btcAmount = await bitcoin.getBtcReceivingAmount(
            btcMempoolTxn,
            btcAtlasDepositAddress
          );

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
            //btc_amount: btcAmount, //old records
            btc_amount: btcAmount + protocolFee + mintingFee, //new records
            protocol_fee: protocolFee,
            minted_txn_hash: mintedTxnHash,
            minting_fee: mintingFee,
            timestamp: btcMempoolTxn.status.block_time,
            status: btcStatus,
            remarks: remarks,
            date_created: btcMempoolTxn.status.block_time, // this field not used in validation
            verified_count: 0, // this field not used in validation
            yield_provider_gas_fee: yieldProviderGasFee,
            yield_provider_txn_hash: "",
            retry_count: 0, // this field not used in validation
            minted_txn_hash_verified_count: 0, // this field not used in validation
            custody_txn_id: "",
          };
          console.log(btcMempoolDepositRecord);

          try {
            let blnValidated = await near.incrementDepositVerifiedCount(
              btcMempoolDepositRecord
            );

            if (blnValidated) {
              console.log(`BTC Txn Hash ${btcMempoolTxn.txid} Validated.`);
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
      const { DEPOSIT_STATUS, NETWORK_TYPE, EVENT_NAME } = getConstants();
      const allDepositsToValidate = deposits.filter((deposit) => {
        if (deposit.remarks !== "") {
          return false;
        }
        const chainConfig = getChainConfig(deposit.receiving_chain_id);
        const validatorThreshold = chainConfig.validators_threshold;
        return (
          deposit.status === DEPOSIT_STATUS.BTC_PENDING_MINTED_INTO_ABTC &&
          deposit.minted_txn_hash_verified_count < validatorThreshold &&
          deposit.minted_txn_hash
        );
      });

      if (allDepositsToValidate.length === 0) {
        console.log("No deposits to validate.");
        return;
      }

      console.log("[ValidateAtlasBtcDepositsMintedTxnHash] records to validate: ", allDepositsToValidate.length);

      for (const deposit of allDepositsToValidate) {

        // const hasCallerVerifiedMintedTxnHash = await near.hasCallerVerifiedMintedTxnHash(deposit.btc_txn_hash, deposit.minted_txn_hash);
        // if (hasCallerVerifiedMintedTxnHash) {
        //   console.log("[ValidateAtlasBtcDepositsMintedTxnHash] Caller has already verified this minted txn hash");
        //   continue;
        // }

        const chainConfig = getChainConfig(deposit.receiving_chain_id);
        if (chainConfig.networkType === NETWORK_TYPE.EVM) {
          const ethereum = new Ethereum(
            chainConfig.chainID,
            chainConfig.chainRpcUrl,
            chainConfig.gasLimit,
            chainConfig.aBTCAddress,
            chainConfig.abiPath
          );

          const matchingEvent = await ethereum.fetchEventByTxnHashAndEventName(deposit.minted_txn_hash, EVENT_NAME.MINT_DEPOSIT);
          //console.log("matchingEvent: ", matchingEvent);

          if (matchingEvent) {
            const { transactionHash } = matchingEvent;
            const { btcTxnHash } = matchingEvent.returnValues;
            try {
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
            } catch (error) {
              console.error(`Error validating NEAR transaction: ${error}`);
              await sendErrorEmail(error, batchName);
              continue;
            }
          }
        } else if (chainConfig.networkType === NETWORK_TYPE.NEAR) {
          try {
            // if (deposit.minted_txn_hash === "3ox3KPzrApfvRFCwbST9uxntbCBTxrTgZ8dNKLpmPhev" || 
            //   deposit.minted_txn_hash === "4hnr5P7i5sUpQ2t3MyLCn7gYCJBbMZJsAM3Bh4i6X4cm" ||
            //   deposit.minted_txn_hash === "LDELDaegUxv3k9odrN2kTZuXof3PWXjL6UB6hgx9eVV" || 
            //   deposit.minted_txn_hash === "6qhsQrZD4AhkvHryktrXCNz2GAb9QyTXf5t4xb5s5hCp"
            // ) {
            //   console.log(
            //     `Skipping NEAR transaction: ${deposit.minted_txn_hash}`
            //   );
            //   continue;
            // }
            console.log(
              `Validating NEAR transaction: ${deposit.minted_txn_hash}`
            );
            const txResult = await near.provider.txStatus(
              deposit.minted_txn_hash,
              near.contract_id
            );

            // Find receipt with ft_mint event
            const receipt = txResult.receipts_outcome.find((outcome) =>
              outcome.outcome.logs.some((log) => {
                try {
                  const event = JSON.parse(log.replace("EVENT_JSON:", ""));
                  return event.event === "ft_mint";
                } catch (e) {
                  return false;
                }
              })
            );

            if (receipt) {
              const logEntry = receipt.outcome.logs.find((log) => {
                try {
                  const event = JSON.parse(log.replace("EVENT_JSON:", ""));
                  return event.event === "ft_mint";
                } catch (e) {
                  return false;
                }
              });

              if (logEntry) {
                const event = JSON.parse(logEntry.replace("EVENT_JSON:", ""));
                const memo = JSON.parse(event.data[0].memo);
                const btcTxnHash = memo.btc_txn_hash;

                if (btcTxnHash === deposit.btc_txn_hash) {
                  try {
                    const transactionHashValidated =
                      await near.incrementDepositMintedTxnHashVerifiedCount(
                        deposit.btc_txn_hash,
                      deposit.minted_txn_hash
                    );

                  if (transactionHashValidated) {
                    console.log(
                      `${batchName}: transaction:${deposit.minted_txn_hash} validated`
                    );
                  } else {
                      console.log(
                        `${batchName}: transaction:${deposit.minted_txn_hash} validation failed`
                      );
                    }
                  } catch (error) {
                    console.error(`Error validating NEAR transaction: ${error}`);
                    await sendErrorEmail(error, batchName);
                    continue;
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error validating NEAR transaction: ${error}`);
            await sendErrorEmail(error, batchName);
          }
        }
      }

      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
      await sendErrorEmail(error, batchName);
    } finally {
      flagsBatch.ValidateAtlasBtcDepositsMintedTxnHashRunning = false;
    }
  }
}

module.exports = {
  ValidateAtlasBtcDeposits,
  ValidateAtlasBtcDepositsMintedTxnHash,
};
