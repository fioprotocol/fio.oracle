import Web3 from "web3";
import config from "../../config/config";
import fioABI from '../../config/ABI/FIO.json';
import fioNftABI from "../../config/ABI/FIONFT.json"
class EthCtrl {
    constructor() {
        this.web3 = new Web3(config.web3Provider);
        this.fioContract = new this.web3.eth.Contract(fioABI, config.fioContract);
        this.fioNftContract = new this.web3.Contract(fioNftABI, config.fioNftContract);
    }
}

export default new EthCtrl();