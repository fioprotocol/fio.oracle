import logger from './logger.js';
import { syncLogsToS3 } from './s3-sync.js';
import { HOUR_IN_MILLISECONDS } from '../constants/general.js';

/**
 * Schedule periodic S3 sync (without clearing local logs)
 * S3 sync runs ALWAYS, regardless of LOG_TO_FILE setting
 * @param {number} intervalHours - Hours between syncs (default: 1)
 */
export const schedulePeriodicSync = (intervalHours = 1) => {
  const logPrefix = '[S3 Sync]';
  const intervalMs = intervalHours * HOUR_IN_MILLISECONDS;

  // Use original console to ensure messages always appear
  const originalConsole = logger.originalConsole || console;

  originalConsole.log(`${logPrefix} Scheduling S3 sync every ${intervalHours} hour(s)`);

  const runSync = async () => {
    originalConsole.log(`${logPrefix} Starting sync...`);

    try {
      // Never clear local files - just sync to S3
      // S3 sync happens ALWAYS, even if LOG_TO_FILE=false
      await syncLogsToS3({ clearAfterSync: false });
      originalConsole.log(`${logPrefix} ✓ Sync completed`);
    } catch (error) {
      originalConsole.error(`${logPrefix} ✗ Sync failed: ${error.message}`);
    }
  };

  // Run first sync immediately after a short delay (to let server finish starting)
  setTimeout(async () => {
    await runSync();

    // Schedule recurring syncs
    setInterval(runSync, intervalMs);
  }, 5000); // 5 seconds delay to let server finish initialization
};

/**
 * Initialize log scheduling system
 * S3 sync is INDEPENDENT of LOG_TO_FILE setting
 * Can be disabled entirely with ENABLE_S3_SYNC=false for local development
 * @param {number} syncIntervalHours - Hours between syncs (default: 1)
 */
export const initializeLogScheduler = (syncIntervalHours = 1) => {
  // Use original console to ensure messages always appear
  const originalConsole = logger.originalConsole || console;

  originalConsole.log('='.repeat(60));
  originalConsole.log('🕐 Initializing Log Scheduler');
  originalConsole.log('='.repeat(60));
  originalConsole.log('📤 S3 Sync: ENABLED');
  originalConsole.log(
    `   First sync in 5 seconds, then every ${syncIntervalHours} hour(s)`,
  );
  originalConsole.log('='.repeat(60));

  schedulePeriodicSync(syncIntervalHours);

  originalConsole.log('✓ Log scheduler initialized');
  originalConsole.log('='.repeat(60));
};

export default {
  schedulePeriodicSync,
  initializeLogScheduler,
};
