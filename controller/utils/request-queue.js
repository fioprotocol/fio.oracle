/**
 * Request Queue Utility
 * Handles all Infura API requests sequentially to avoid rate limiting
 * Provides built-in retry logic with exponential backoff
 */

export class RequestQueue {
  constructor({
    delayBetweenRequests = 1000, // 1 second between requests (very conservative)
    maxRetries = 3,
    baseRetryDelay = 10000, // 10 seconds base retry delay
    postRetryCooldown = 5000, // 5 second cooldown after retry
  } = {}) {
    this.queue = [];
    this.isProcessing = false;
    this.delayBetweenRequests = delayBetweenRequests;
    this.maxRetries = maxRetries;
    this.baseRetryDelay = baseRetryDelay;
    this.postRetryCooldown = postRetryCooldown;
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
    };
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function that performs the request
   * @param {Object} context - Context information for logging
   * @returns {Promise} - Resolves with the result or rejects with error
   */
  async enqueue(requestFn, context = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFn,
        context,
        resolve,
        reject,
        retryCount: 0,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the queue sequentially
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const wasRetried = await this.executeRequest(item);

      // Add delay between requests to respect rate limits
      if (this.queue.length > 0) {
        let delay = this.delayBetweenRequests;

        // If we just retried a request due to rate limiting, add FULL cooldown
        // This gives Infura time to reset its rate limit counter
        if (wasRetried) {
          delay += this.postRetryCooldown;
          console.log(
            `[Queue] Adding ${this.postRetryCooldown}ms cooldown after retry (total delay: ${delay}ms)`,
          );
        }

        await this.sleep(delay);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Execute a single request with retry logic
   * @returns {boolean} - True if request was retried, false otherwise
   */
  async executeRequest(item) {
    const { requestFn, context, resolve, reject, retryCount } = item;
    const { logPrefix = '', from, to } = context;

    this.stats.totalRequests++;

    try {
      if (logPrefix) {
        console.log(
          `${logPrefix} [Queue] Processing request (${this.stats.totalRequests} total, ${this.queue.length} remaining)`,
        );
      }

      const result = await requestFn();
      this.stats.successfulRequests++;
      resolve(result);
      return false; // Not retried
    } catch (error) {
      const isRateLimitError = error.statusCode === 429 || error.code === 100;

      if (isRateLimitError && retryCount < this.maxRetries) {
        // Retry with exponential backoff
        const retryDelay = this.baseRetryDelay * Math.pow(2, retryCount);
        this.stats.retriedRequests++;

        console.log(
          `${logPrefix} [Queue] Rate limit hit. Retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${this.maxRetries})${from && to ? ` for blocks ${from}-${to}` : ''}`,
        );

        await this.sleep(retryDelay);

        // Re-queue with incremented retry count
        this.queue.unshift({
          requestFn,
          context,
          resolve,
          reject,
          retryCount: retryCount + 1,
        });

        return true; // Was retried
      } else {
        // Max retries reached or non-retryable error
        this.stats.failedRequests++;

        if (logPrefix) {
          console.error(
            `${logPrefix} [Queue] Request failed${from && to ? ` for blocks ${from}-${to}` : ''}:`,
            error.message || error,
          );
        }

        reject(error);
        return false; // Not retried (failed)
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Print queue statistics
   */
  printStats(prefix = '') {
    const stats = this.getStats();
    console.log(`${prefix}[Queue Stats]`, {
      total: stats.totalRequests,
      successful: stats.successfulRequests,
      failed: stats.failedRequests,
      retried: stats.retriedRequests,
      pending: stats.queueLength,
    });
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
    };
  }
}

// Export a singleton instance for global use with EXTREMELY conservative rate limiting
// Infura free tier appears to have VERY strict limits (likely 2-3 requests per 10 seconds)
export const globalRequestQueue = new RequestQueue({
  delayBetweenRequests: 1000, // 1 second between requests (12 req/min max)
  maxRetries: 3, // Max 3 retry attempts
  baseRetryDelay: 10000, // 10s base delay for retries (10s, 20s, 40s)
  postRetryCooldown: 5000, // 5s cooldown after any retry
});
