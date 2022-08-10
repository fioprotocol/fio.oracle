require('dotenv').config();
import config from '../config/config';
const { curly } = require('node-libcurl')

import { getLastProceededBlockNumberOnFioChain } from "./helpers";

class UtilCtrl {
    constructor(){
    }
    async getUnprocessedActionsOnFioChain(accountName, pos) {
      const lastNumber = getLastProceededBlockNumberOnFioChain();
      let offset = parseInt(process.env.POLLOFFSET);
      let data = await this.getActions(accountName, pos, offset);
      while(data.length > 0 && data[0].block_num > lastNumber) {
        offset -= 10;
        data = await this.getActions(accountName, pos, offset);
      }
      return data.filter(elem => elem.block_num > lastNumber)
    }

    async getLatestWrapDomainAction(accountName, pos) {
      const lastNumber = config.oracleCache.get("lastBlockNumber");
      var offset = parseInt(process.env.POLLOFFSET);
      var data = await this.getActions(accountName, pos, offset);
      while(data.length > 0 && data[0].block_num > lastNumber) {
        offset -= 10;
        data = await this.getActions(accountName, pos, offset);
      }
      var realData = Array();
      for(var i = 0; i < data.length; i++) {
        if (data[i].block_num > lastNumber) {
          realData.push(data[i]);
        }
        const len = realData.length;
        if( len > 0) {
          config.oracleCache.set("lastBlockNumber", realData[len-1].block_num)
        }
      }
      return realData;
    }

    async getActions(accountName, pos, offset) {
        const data = await curly.post(process.env.FIO_SERVER_URL_HISTORY + 'v1/history/get_actions', {
          postFields: JSON.stringify({"account_name": accountName, "pos": pos, offset: offset}),
          httpHeader: [
            'Content-Type: application/x-www-form-urlencoded',
          ],
        });
        if (data.statusCode === 200) {
          const dataLen = Object.keys(data.data.actions).length;
          let array = Array();
          for (let i = 0; i < dataLen; i++) {
            array.push(data.data.actions[i]);
          }
          return array;
        }
        // return [];
    }

    async getBalance(accountName) {
      const data = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_account', {
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
        const balanceData = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_fio_balance', {
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
      const data = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_oracle_fees', {
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
      const data = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_account', {
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
        const addressData = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_fio_addresses', {
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
      const response = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/avail_check', {
        postFields: JSON.stringify({ "fio_name": fioName}),
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      var registered = 0;
      if (response.statusCode == 200) {
        registered = response.data.is_registered;
      }
      return registered;
    }
    async getInfo() {
      const response = await curly.post(process.env.FIO_SERVER_URL_ACTION+'v1/chain/get_info', {
        httpHeader: [
          'Content-Type: application/x-www-form-urlencoded',
        ],
      });
      var lastBlockNum = 0;
      if (response.statusCode == 200) {
        lastBlockNum = response.data.last_irreversible_block_num;
      }
      return lastBlockNum;
    }
}
export default new UtilCtrl();
