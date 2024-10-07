import express from 'express';

import { checkAPIKey } from './middle.js';
import fioCtrl from '../api/fio.js';

const route = express.Router();

route.post('/getAccount', checkAPIKey, (req, res) =>
  fioCtrl.handleUnprocessedWrapActionsOnFioChain(req, res),
);
export default route;
