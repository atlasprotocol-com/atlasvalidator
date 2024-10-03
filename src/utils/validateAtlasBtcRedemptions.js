const { Web3 } = require("web3");

const { getConstants } = require("../constants");
const { Ethereum } = require("../services/ethereum");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch } = require("./batchFlags");


// VALIDATOR BATCH FOR BTC REDEMPTIONS:
// 1. Retrieve all NEAR redemption records with status = RED_ABTC_BURNT and verified_count < chain_id.validators_threshold
// 2. For each NEAR redemption record, find BurnRedeem event from respective chain_id and prepare a mempool_redemption record to pass into NEAR function
// 3. Call NEAR function increment_redemption_verified_count by passing in the mempool_redemption record
// 4. TO DISCUSS: If validator_threshold gets updated suddenly, will this introduce any bugs?
// 5. TO DISCUSS: Cannot delete verifications records else we are not able to allocate the airdrop
// 6. TO DISCUSS: How to prevent authorised validators to directly call the public NEAR function increment_redemption_verified_count without going through this server.js function?
async function ValidateAtlasBtcRedemptions(  
  redemptions,
  accountId,
  near,  
) {
  const batchName = `Validator Batch ValidateAtlasBtcRedemptions`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcRedemptionsRunning) {
    //console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcRedemptionsRunning = true;

      // Retrieve constants and validators_threshold
      const { REDEMPTION_STATUS, NETWORK_TYPE, DELIMITER } = getConstants(); // Access constants dynamically
      // console.log(REDEMPTION_STATUS);
      // console.log(NETWORK_TYPE);

      // Get all chain_ids which the validator is authorised to validate and network type = EVM      
      const allChainIdsToValidate = await near.getChainIdsByValidatorAndNetworkType(accountId, NETWORK_TYPE.EVM);
      //console.log(accountId);
      //console.log(NETWORK_TYPE.EVM);
      //console.log(allChainIdsToValidate);
      
      // Go through each authorised chain_id for this validator
      for (const chainId of allChainIdsToValidate) {
        
        const chainConfig = getChainConfig(chainId);
        //console.log(chainId);
        //console.log(chainConfig);
      
        let validatorThreshold = chainConfig.validators_threshold;     
        //console.log(`validatorThreshold for chain_id ${chainId}: ${validatorThreshold}`);
        //console.log(REDEMPTION_STATUS.ABTC_BURNT);
        //console.log(redemptions);
        
        // Retrieve all NEAR redemption records with respective abtc_redemption_chain_id, status = ABTC_BURNT and verified_count < chain_id.validators_threshold
        const allRedemptionsToValidate = redemptions.filter(
          (redemption) =>
            redemption.abtc_redemption_chain_id === chainId &&
            redemption.status === REDEMPTION_STATUS.ABTC_BURNT &&
            redemption.remarks === "" &&
            redemption.verified_count < validatorThreshold,
        );
        console.log(`chainId: ${chainId} - allRedemptionsToValidate.length: ${allRedemptionsToValidate.length}`);
        
        // For each NEAR redemption record, find BurnRedeem events from respective chainId mempool and for each BurnRedeem event: prepare a mempool_redemption record to pass into NEAR function
        for (const nearTxn of allRedemptionsToValidate) {
          
          const web3 = new Web3(chainConfig.chainRpcUrl);
          const ethereum = new Ethereum(
            chainConfig.chainID,
            chainConfig.chainRpcUrl,
            chainConfig.gasLimit,
            chainConfig.aBTCAddress,
            chainConfig.abiPath,
          );

          //fetch all BurnRedeem Events (TO-DO: Read start block from file based on chainId)
          const endBlock = await ethereum.getCurrentBlockNumber();          
          const events = await ethereum.getPastBurnEventsInBatches(
            //endBlock - 1600000n,     // to test Arb Sepolia
            endBlock - 700000n,   // to test OP Sepolia
            endBlock,
            chainConfig.batchSize,
          );

          console.log(
            `${chainConfig.networkName}: Found ${events.length} Burn events`,
          );

          //initialise RedemptionRecord for each Burn event in one EVM chain
          for (const event of events) {            
            
            const { returnValues, transactionHash, blockNumber } = event;
            const { wallet, btcAddress, amount } = returnValues;
            
            const block = await web3.eth.getBlock(blockNumber);
            let redemptionTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;              
            let aBtcRedemptionChainId = chainConfig.chainID;
            let timestamp = Number(block.timestamp);            
            let remarks = "";

            // Fetch the transaction receipt to check the status
            const receipt = await web3.eth.getTransactionReceipt(transactionHash);
            let evmStatus = 0;
            if (receipt.status) {
              evmStatus = REDEMPTION_STATUS.ABTC_BURNT;
            }

            // Create the RedemptionRecord object
            const evmMempoolRedemptionRecord = {
              txn_hash: redemptionTxnHash,
              abtc_redemption_address: wallet,
              abtc_redemption_chain_id: aBtcRedemptionChainId,
              btc_receiving_address: btcAddress,
              abtc_amount: Number(amount),
              btc_txn_hash: "",           // this field not used in validation
              timestamp: timestamp,
              status: evmStatus,
              remarks: remarks,
              date_created: timestamp,    // this field not used in validation
              verified_count: 0,           // this field not used in validation
              custody_txn_id: ""
            };
            //console.log(evmMempoolRedemptionRecord);

            let blnValidated = await near.incrementRedemptionVerifiedCount(evmMempoolRedemptionRecord);
            if (blnValidated) {
              console.log(`Txn Hash ${redemptionTxnHash} Validated.`);
            }
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
