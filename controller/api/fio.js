import utilCtrl from '../util';
import ethCtrl from '../api/eth';
import { bignumber } from 'mathjs';
class FIOCtrl {
    constructor() {}
    async getActions(req,res) {
        // const account_name = req.body.account_name;
        // const pos = req.body.pos;
        // if (!account_name || account_name == "") return res.status(200).json({ error: "Account name is missing" });
        // if (!pos || pos == "") return res.status(200).json({ error: "Pos is missing" });
        const wrapData = await utilCtrl.getActions("qhh25sqpktwh", -1);
        const dataLen = Object.keys(wrapData).length;
        if (dataLen != 0 ) {
            for (var i = 0; i<dataLen;i++){
                if (wrapData[i].action_trace.act.data.memo == "Token Wrapping") {
                    const quantity = wrapData[i].action_trace.act.data.quantity;
                    const bn = bignumber(quantity.split(".")[0]);
                    const weiQuantity = Number(bn) * 1000000000;
                    const tx_id = wrapData[i].action_trace.trx_id;
                    ethCtrl.wrapFunction(tx_id, weiQuantity);
                }
            }      
        }
    }
}

export default new FIOCtrl();