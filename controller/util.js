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
    async getBalance(accountName) {
      const data = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/get_account', {
        postFields: JSON.stringify({ "account_name": accountName}),
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      var balanceAmount = 0;
      if (data.statusCode == 200) {
        const permission = data.data.permissions;
        const keyData = permission[0].required_auth.keys;
        const pubKey = keyData[0].key;
        const balanceData = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/get_fio_balance', {
          postFields: JSON.stringify({ "fio_public_key": pubKey}),
          httpHeader: [
            'Content-Type: application/x-www-form-urlencoded',
          ],
        });
        if(balanceData.statusCode == 200) {
          balanceAmount = balanceData.data.balance;
        }
      }
      return balanceAmount;
    }
    async getOracleFee() {
      const data = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/get_oracle_fees', {
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      if(data.statusCode == 200) {
        const fee = data.data.oracle_fees[1].fee_amount;
        if (fee > 0) { console.log(true); return true; }
        else { console.log(false); return false; }
      }
    }
    async getFIOAddress(accountName) {
      const data = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/get_account', {
        postFields: JSON.stringify({ "account_name": accountName}),
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      if (data.statusCode == 200) {
        const permission = data.data.permissions;
        const keyData = permission[0].required_auth.keys;
        const pubKey = keyData[0].key;
        var fio_address = "";
        const addressData = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/get_fio_addresses', {
          postFields: JSON.stringify({ "fio_public_key": pubKey}),
          httpHeader: [
            'Content-Type: application/x-www-form-urlencoded',
          ],
        });
        if(addressData.statusCode == 200) {
          const addresses = addressData.data.fio_addresses;
          fio_address = addresses[0].fio_address; 
        }
      }
      return fio_address;
    }
    async availCheck(fioName) {
      const response = await curly.post(process.env.SERVER_URL_HISTORY+'v1/chain/avail_check', {
        postFields: JSON.stringify({ "fio_name": fioName}),
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      var registered = 0;
      if (response.statusCode == 200) {
        registered = response.data.is_registered;
      }
      console.log("regitsred: ", registered)
      return registered;
    }
}
export default new UtilCtrl();