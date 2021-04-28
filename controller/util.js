const { curly } = require('node-libcurl')

class UtilCtrl {
    constructor(){
    }
    async getActions(accountName, pos) {
        const data = await curly.post(process.env.SERVER_URL_HISTORY+'v1/history/get_actions', {
             postFields: JSON.stringify({ "account_name": accountName, "pos": pos}),
             httpHeader: [
               'Content-Type: application/x-www-form-urlencoded',
             ],
           });
         return data;
     }
}
export default new UtilCtrl();