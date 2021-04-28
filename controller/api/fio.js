import utilCtrl from '../util';
const { curly } = require('node-libcurl')

class FIOCtrl {
    constructor() {}
    async getActions(req, res) {
        const account_name = req.body.account_name;
        const pos = req.body.pos;
        if (!account_name || account_name == "") return res.status(200).json({ error: "Account name is missing" });
        if (!pos || pos == "") return res.status(200).json({ error: "Pos is missing" });
        const data = await utilCtrl.getActions(account_name, pos);
        res.status(200).send(data);
    }
}

export default new FIOCtrl();