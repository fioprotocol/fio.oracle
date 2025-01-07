import Big from 'big.js';

class MathOp {
  value;

  constructor(x) {
    try {
      if (!isNaN(+x) && Big(x)) {
        this.value = x;
      } else {
        throw new Error(`${x} is not a number`);
      }
    } catch (err) {
      console.error(`${err.message}. Received input - ${x}`);
      throw err;
    }
  }

  abs() {
    try {
      return Big(this.value).abs();
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  add(x) {
    try {
      this.value = Big(this.value).plus(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  sub(x) {
    try {
      this.value = Big(this.value).minus(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  mul(x) {
    try {
      this.value = Big(this.value).times(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  div(x) {
    try {
      this.value = Big(this.value).div(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  sum(...args) {
    try {
      this.value = args.reduce((sum, current) => Big(sum).plus(current), 0);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  mod(modDigit) {
    try {
      this.value = Big(this.value).mod(modDigit);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  round(decimalPlaces, roundingMode) {
    try {
      this.value = Big(this.value).round(decimalPlaces, roundingMode);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return this;
  }

  eq(x) {
    try {
      return Big(this.value).eq(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  gt(x) {
    try {
      return Big(this.value).gt(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  gte(x) {
    try {
      return Big(this.value).gte(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  lt(x) {
    try {
      return Big(this.value).lt(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  lte(x) {
    try {
      return Big(this.value).lte(x);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  toNumber() {
    try {
      return Big(this.value).toNumber();
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  toString() {
    try {
      return Big(this.value).toString();
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  toFixed(toFixedDigit) {
    try {
      return Big(this.value).toFixed(toFixedDigit);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
}

export default MathOp;
