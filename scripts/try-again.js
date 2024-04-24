import fs from 'fs';

import { LOG_FILES_PATH_NAMES } from '../controller/constants.js';

const REGISTERED_JOBS_LIST = {
    wrapEth: 'wrapEth',
    unwrapEth: 'unwrapEth',
    wrapPoly: 'wrapPoly',
    unwrapPoly: 'unwrapPoly',
};

process.argv[2].split('=')[1].split(',').forEach(((jobName) => {
    if (jobName === REGISTERED_JOBS_LIST.wrapEth) {
        const errItems = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue).toString();
        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionErrorQueue, "");
        fs.appendFileSync(LOG_FILES_PATH_NAMES.wrapEthTransactionQueue, errItems);
    }

    if (jobName === REGISTERED_JOBS_LIST.unwrapEth) {
        const errItems = fs.readFileSync(LOG_FILES_PATH_NAMES.unwrapEthTransactionErrorQueue).toString();
        fs.writeFileSync(LOG_FILES_PATH_NAMES.unwrapEthTransactionErrorQueue, "");
        fs.appendFileSync(LOG_FILES_PATH_NAMES.unwrapEthTransactionQueue, errItems);
    }

    if (jobName === REGISTERED_JOBS_LIST.wrapPoly) {
        const errItems = fs.readFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue).toString();
        fs.writeFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionErrorQueue, "");
        fs.appendFileSync(LOG_FILES_PATH_NAMES.wrapPolygonTransactionQueue, errItems);
    }

    if (jobName === REGISTERED_JOBS_LIST.unwrapPoly) {
        const errItems = fs.readFileSync(LOG_FILES_PATH_NAMES.unwrapPolygonTransactionErrorQueue).toString();
        fs.writeFileSync(LOG_FILES_PATH_NAMES.unwrapPolygonTransactionErrorQueue, "");
        fs.appendFileSync(LOG_FILES_PATH_NAMES.unwrapPolygonTransactionQueue, errItems);
    }
}))

console.log('Successfully Completed. It is necessary to wait some time for Jobs to process new transactions.')
