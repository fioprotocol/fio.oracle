import config from '../config/config';

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
        if(data.statusCode === 200) {
          const actionIdx = config.oracleCache.get("actionIndex");
          const dataLen = Object.keys(data.data.actions).length;
          var array = Array();
          for (var i = 0; i<dataLen;i++){
            if (data.data.actions[i].account_action_seq > actionIdx) {
                array.push(data.data.actions[i]);
            }
            config.oracleCache.set("actionIndex", data.data.actions[dataLen-1].account_action_seq)
          }
          return array;           
        }
        return [];
     }
}
export default new UtilCtrl();