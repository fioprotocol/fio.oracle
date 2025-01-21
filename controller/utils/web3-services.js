import { Web3 } from 'web3';

import fioABI from '../../config/ABI/FIO.json' assert { type: 'json' };
import fioNftABI from '../../config/ABI/FIOMATICNFT.json' assert { type: 'json' };

import config from '../../config/config.js';

const {
  eth: { ETH_CONTRACT },
  infura: { eth, polygon },
  polygon: { POLYGON_CONTRACT },
} = config;

export class Web3Service {
  static getEthWeb3() {
    if (!this.ethInstance) {
      this.ethInstance = new Web3(eth);
    }
    return this.ethInstance;
  }

  static getPolygonWeb3() {
    if (!this.polygonInstance) {
      this.polygonInstance = new Web3(polygon);
    }
    return this.polygonInstance;
  }

  static getEthContract() {
    if (!this.ethContractInstance) {
      const ethWeb3Instance = this.getEthWeb3();

      this.ethContractInstance = new ethWeb3Instance.eth.Contract(fioABI, ETH_CONTRACT);
    }
    return this.ethContractInstance;
  }

  static getPolygonContract() {
    if (!this.polygonContractInstance) {
      const polygonWeb3Instance = this.getPolygonWeb3();

      this.polygonContractInstance = new polygonWeb3Instance.eth.Contract(
        fioNftABI,
        POLYGON_CONTRACT,
      );
    }
    return this.polygonContractInstance;
  }
}
