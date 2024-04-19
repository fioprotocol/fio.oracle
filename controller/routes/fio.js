import fioCtrl from '../api/fio.js';
import { checkAPIKey } from './middle.js';

import express from 'express';

const route = express.Router();

route.post('/getAccount', checkAPIKey , (req, res) => fioCtrl.handleUnprocessedWrapActionsOnFioChain(req,res));
export default route;
