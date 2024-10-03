// utils/fetchWithRetry.js
const axios = require("axios");

// Function which fetches data from BTC mempool
async function fetchWithRetry(
  axiosConfig,
  retries = 5,
  delay = 2000,
  timeout = 5000,
) {
  for (let i = 0; i < retries; i++) {
    try {
      const configWithTimeout = { ...axiosConfig, timeout };
      const response = await axios(configWithTimeout);
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed: ${error.message}`);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(
    `Failed to fetch from BTC mempool after ${retries} attempts, URL attempting is ${axiosConfig.url}`,
  );
}

module.exports = fetchWithRetry;
