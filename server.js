import bodyParser from 'body-parser';
import express from 'express';

import conf from './config/config.js';
import mainCtrl from './controller/main.js';
import { sleep } from './controller/utils/general.js';

const {
  app: { RESTART_TIMEOUT, MAX_RETRIES },
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
    console.log(`server listening on *: ${port}`);
  });

  try {
    await mainCtrl.start(app);
    serverStarted = true;
  } catch (error) {
    console.error('Server crashed with error:', error);
    server.close();

    if (!serverStarted) {
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      console.log(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  }

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    server.close();

    if (!serverStarted) {
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      console.log(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close();

    if (!serverStarted) {
      console.error('Server failed during startup. Exiting without retry.');
      process.exit(1);
    }

    if (currentRetries < MAX_RETRIES) {
      currentRetries++;
      console.log(
        `Attempting restart ${currentRetries}/${MAX_RETRIES} in ${RESTART_TIMEOUT / 1000} seconds...`,
      );

      await sleep(RESTART_TIMEOUT);
      startServer();
    } else {
      console.error(`Maximum retry attempts (${MAX_RETRIES}) reached. Shutting down.`);
      process.exit(1);
    }
  });
};

// Initial server start
startServer();
