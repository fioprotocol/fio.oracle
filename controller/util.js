require('dotenv').config();

import fetch from "node-fetch";
import config from '../config/config';

import {checkHttpResponseStatus, getLastProceededBlockNumberOnFioChain} from "./helpers";

const fioHttpEndpoint = process.env.FIO_SERVER_URL_ACTION;

class UtilCtrl {
    constructor(){
    }

    async getLastIrreversibleBlockOnFioChain() {
        const fioChainInfoResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_info')

        await checkHttpResponseStatus(fioChainInfoResponse, 'Getting FIO chain info went wrong.');

        const fioChainInfo = await fioChainInfoResponse.json();

        let lastBlockNum = 0;
        if (fioChainInfo.last_irreversible_block_num) lastBlockNum = fioChainInfo.last_irreversible_block_num;

        return lastBlockNum;
    }

    async getUnprocessedActionsOnFioChain(accountName, pos, logPrefix) {
        const lastNumber = getLastProceededBlockNumberOnFioChain();

        console.log(logPrefix + `start Block Number = ${lastNumber + 1}, end Block Number: ${pos}`)

        let data = []
        const isV2 = process.env.FIO_SERVER_HISTORY_VERSION === 'hyperion';
        if (isV2) {
            let hasMore = true;
            let skip = 0;
            const limit = parseInt(process.env.HYPERION_LIMIT) || 10
            const lastIrreversibleBlock = await this.getLastIrreversibleBlockOnFioChain();

            while (hasMore) {
                const dataPart = await this.getActionsV2(accountName, skip, limit, lastIrreversibleBlock);
                data = data.concat(dataPart);

                hasMore = dataPart.length >= limit && dataPart[0].block_num > lastNumber
                skip += limit;
            }
        } else {
            let offset = parseInt(process.env.POLLOFFSET);
            data = await this.getActions(accountName, pos, offset);
            while (data.length > 0 && data[0].block_num > lastNumber) {
                offset -= 10;
                data = await this.getActions(accountName, pos, offset);
            }
        }
        return data.filter(elem => (elem.block_num > lastNumber))
    }

    async getActionsV2(accountName, skip, limit, lastIrreversibleBlock) {
        let actionsHistoryResponse
        try {
            actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY + 'v2/history/get_actions?account=' + accountName + '&skip=' + skip + '&limit=' + limit)
            await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
        } catch (e) {
            if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
                actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY_BACKUP + 'v2/history/get_actions?account=' + accountName + '&skip=' + skip + '&limit=' + limit)
                await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
            }
        }
        const actionsHistory = await actionsHistoryResponse.json();

        let result = [];
        if (actionsHistory.actions.length) {
            result = actionsHistory.actions.filter(elem => elem.block_num <= lastIrreversibleBlock).map(elem => ({
                ...elem,
                action_trace: {
                    act: elem.act,
                    trx_id: elem.trx_id,
                },
            }));
        }
        return result;
    }

    async getActions(accountName, pos, offset) {
        let actionsHistoryResponse
        try {
            actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY + 'v1/history/get_actions', {
                body: JSON.stringify({"account_name": accountName, "pos": pos, offset: offset}),
                method: 'POST'
            });
            await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
        } catch (e) {
            if (process.env.FIO_SERVER_URL_HISTORY_BACKUP) {
                actionsHistoryResponse = await fetch(process.env.FIO_SERVER_URL_HISTORY_BACKUP + 'v1/history/get_actions', {
                    body: JSON.stringify({"account_name": accountName, "pos": pos, offset: offset}),
                    method: 'POST'
                });
                await checkHttpResponseStatus(actionsHistoryResponse, 'Getting FIO actions history went wrong.');
            }
        }
        const actionsHistory = await actionsHistoryResponse.json();

        let result = [];
        if (actionsHistory.actions.length) result = actionsHistory.actions.filter(elem => elem.block_num <= actionsHistory.last_irreversible_block)
        return result;
    }

    async getLatestWrapDomainAction(accountName, pos) {
        const lastNumber = config.oracleCache.get("lastBlockNumber");
        let offset = parseInt(process.env.POLLOFFSET);
        let data = await this.getActions(accountName, pos, offset);
        while(data.length > 0 && data[0].block_num > lastNumber) {
            offset -= 10;
            data = await this.getActions(accountName, pos, offset);
        }
        const realData = [];
        for(let i = 0; i < data.length; i++) {
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

    async getBalance(accountName) {
        const accountDataResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_account', {
            body: JSON.stringify({ "account_name": accountName}),
            method: 'POST'
        });
        await checkHttpResponseStatus(accountDataResponse, 'Getting account information went wrong.');
        const accountData = await accountDataResponse.json();

        const permission = accountData.permissions;
        const keyData = permission[0].required_auth.keys;
        const pubKey = keyData[0].key;

        const balanceDataResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_fio_balance', {
            body: JSON.stringify({ "fio_public_key": pubKey}),
            method: 'POST'
        });
        await checkHttpResponseStatus(balanceDataResponse, 'Getting account balance information went wrong.');
        const balanceData = await balanceDataResponse.json();
        return balanceData.balance;
    }

    async getOracleFee() {
        const getOracleFeesResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_oracle_fees');

        await checkHttpResponseStatus(getOracleFeesResponse, 'Getting oracle fees info went wrong.');

        const oracleFees = await getOracleFeesResponse.json();

        const fee = oracleFees.oracle_fees[1].fee_amount;
        if (fee > 0) {
            console.log(true);
            return true;
        } else {
            console.log(false);
            return false;
        }
    }

    async getFIOAddress(accountName) {
        const accountDataResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_account', {
            body: JSON.stringify({ "account_name": accountName}),
            method: 'POST'
        })

        await checkHttpResponseStatus(accountDataResponse, 'Getting account information went wrong.')

        const accountData = await accountDataResponse.json()

        const permission = accountData.permissions;
        const keyData = permission[0].required_auth.keys;
        const pubKey = keyData[0].key;
        let fio_address = "";

        const addressDataResponse = await fetch(fioHttpEndpoint + 'v1/chain/get_fio_addresses', {
            body: JSON.stringify({ "fio_public_key": pubKey}),
            method: 'POST'
        })

        await checkHttpResponseStatus(addressDataResponse, 'Getting address information went wrong.')

        const addressData = await addressDataResponse.json()

        const addresses = addressData.fio_addresses;
        fio_address = addresses[0].fio_address;

        return fio_address;
    }

    async availCheck(fioName) {
        const availCheckResponse = await fetch(fioHttpEndpoint + 'v1/chain/avail_check', {
            body: JSON.stringify({ "fio_name": fioName}),
            method: 'POST'
        })

        await checkHttpResponseStatus(availCheckResponse, 'Checking available FIO name went wrong.')

        const data = await availCheckResponse.json()

        return  !!(data && data.is_registered);
    }
}
export default new UtilCtrl();
