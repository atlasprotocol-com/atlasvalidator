let chainConfig = {};

// Function to fetch chain configurations from NEAR and populate the chainConfig object
async function fetchAndSetChainConfigs(near) {
  try {
    const chainConfigs = await near.getChainConfigs(); // Fetch chain configs from NEAR

    // Convert the chainConfigs array into a key-value pair object
    chainConfigs.forEach((config) => {
      chainConfig[config.chain_id] = {
        chainID: config.chain_id,
        networkType: config.network_type,
        networkName: config.network_name,
        chainRpcUrl: config.chain_rpc_url,
        explorerURL: config.explorer_url,
        aBTCAddress: config.abtc_address,
        nativeCurrency: {
          name: config.native_currency_name,
          decimals: config.native_currency_decimals,
          symbol: config.native_currency_symbol,
        },
        firstBlock: config.first_block,
        batchSize: config.batch_size,
        gasLimit: config.gas_limit,
        abiPath: config.abi_path,
        abiPath: config.abi_path,
        validators_threshold: config.validators_threshold,
      };
    });

    console.log("Chain configuration loaded successfully:", chainConfig);
  } catch (error) {
    console.error("Error fetching chain configurations:", error);
  }
}

// Function to get the chain configuration for a specific chainID
function getChainConfig(chainID) {
  if (chainConfig[chainID]) {
    return chainConfig[chainID];
  } else {
    throw new Error(`Chain configuration for chainID ${chainID} not found`);
  }
}

// Function to get the chain configuration for a specific chainID
function getAllChainConfig() {
  return chainConfig;
}

module.exports = {
  fetchAndSetChainConfigs,
  getChainConfig,
  getAllChainConfig
};
