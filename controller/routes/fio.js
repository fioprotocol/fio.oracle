import fioCtrl from "../api/fio";
import { checkAPIKey } from "./middle";

const route = require("express").Router();

route.post("/getAccount", checkAPIKey , (req, res) => fioCtrl.handleUnprocessedWrapActions(req,res));
export default route;
