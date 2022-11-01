import fioCtrl from "../api/fio";
import { checkAPIKey } from "./middle";

const route = require("express").Router();

route.post("/getAccount", checkAPIKey , (req, res) => fioCtrl.handleUnprocessedWrapActionsOnFioChain(req,res));
export default route;
