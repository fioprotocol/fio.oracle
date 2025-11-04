import bodyParser from 'body-parser';
import express from 'express';

import conf from './config/config.js';
import mainCtrl from './controller/main.js';
import { sleep } from './controller/utils/general.js';
import logger from './controller/utils/logger.js';

const {
  app: { RESTART_TIMEOUT, MAX_RETRIES, STABILITY_THRESHOLD },
  port,
} = conf;

let currentRetries = 0;
let serverStarted = false;

const startServer = async () => {
  const app = express();
  app.use(
    express.urlencoded({
      extended: true,
    }),
  );

  app.use(express.json());
  app.use(bodyParser.json());

  const server = app.listen(port, () => {
    // Always show server start in console
    console.log(`server listening on *: ${port}`);
    logger.info(`Server listening on port: ${port}`, { consoleOnly: true });
  });

  try {
    await mainCtrl.start(app);
    serverStarted = true;

    // Only reset the retry counter after the server has been stable for STABILITY_THRESHOLD
    setTimeout(() => {
      currentRetries = 0;
      logger.info('Server stable, retry counter reset');
    }, STABILITY_THRESHOLD);
  } catch (error) {
    logger.error(`Server crashed with error: ${error.message}`);
    console.error('Server crashed with error:', error);
    server.close();

    if (!serverStarted) {
      logger.error('Server failed during startup. Exiting without retry.');
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      logger.warn(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      logger.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  }

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    console.error('Uncaught Exception:', error);
    server.close();

    if (!serverStarted) {
      logger.error('Server failed during startup. Exiting without retry.');
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      logger.warn(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      logger.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error(`Unhandled Rejection: ${reason}`);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close();

    if (!serverStarted) {
      logger.error('Server failed during startup. Exiting without retry.');
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      logger.warn(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      logger.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  });
};

// Initial server start
startServer();
