// batchFlags.js
const flagsBatch = {
  UpdateAtlasBtcDepositsRunning: false,
  ValidateAtlasBtcDepositsRunning: false,
  MintaBtcToReceivingChainRunning: false,
  UpdateAtlasAbtcMintedRunning: false,
  UpdateAtlasBtcRedemptionsRunning: false,
  ValidateAtlasBtcRedemptionsRunning: false,
  SendBtcBackToUserRunning: false,
  UpdateAtlasBtcBackToUserRunning: false,
  ValidateAtlasBtcBridgingsRunning: false,
};

function blockRange(block, start = 1000, end = 2000) {
  if (!Number.isSafeInteger(block)) {
    return end;
  }

  if (block < start) return end;
  if (block > end) return end;

  return block;
}

module.exports = { flagsBatch, blockRange };
