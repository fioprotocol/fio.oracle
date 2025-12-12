export const GAS_PRICE_MULTIPLIERS = {
  REPLACEMENT: 1.5, // 50% increase for replace (minimum required by most networks)
  REPLACEMENT_PROGRESSIVE: 1.1, // Additional 10% per replacement attempt
  RETRY: 1.2, // 20% increase for retry
  AVERAGE: 1.2, // 20% increase for average priority
  HIGH: 1.4, // 40% increase for high priority
};
