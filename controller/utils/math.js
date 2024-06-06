import Big from 'big.js';

class MathOp {
  value;

  constructor(x) {
    this.value = !isNaN(+x) ? x : 0;
  }

  add(x) {
    try {
      this.value = Big(this.value).plus(x);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  sub(x) {
    try {
      this.value = Big(this.value).minus(x);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  mul(x) {
    try {
      this.value = Big(this.value).times(x);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  div(x) {
    try {
      this.value = Big(this.value).div(x);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  sum(...args) {
    try {
      this.value = args.reduce((sum, current) => Big(sum).plus(current), 0);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  mod(modDigit) {
    try {
      this.value = Big(this.value).mod(modDigit);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  round(decimalPlaces, roundingMode) {
    try {
      this.value = Big(this.value).round(decimalPlaces, roundingMode);
    } catch (err) {
      console.error(err);
    }
    return this;
  }

  eq(x){
    try {
      return Big(this.value).eq(x || 0);
    } catch (err) {
      console.error(err);
      return this.value === x;
    }
  }

  gt(x){
    try {
      return Big(this.value).gt(x || 0);
    } catch (err) {
      console.error(err);
      return this.value > x;
    }
  }

  gte(x){
    try {
      return Big(this.value).gte(x || 0);
    } catch (err) {
      console.error(err);
      return this.value >= x;
    }
  }

  lt(x){
    try {
      return Big(this.value).lt(x || 0);
    } catch (err) {
      console.error(err);
      return this.value < x;
    }
  }

  lte(x){
    try {
      return Big(this.value).lte(x || 0);
    } catch (err) {
      console.error(err);
      return this.value <= x;
    }
  }

  toNumber() {
    try {
      return Big(this.value).toNumber();
    } catch (err) {
      console.error(err);
      return +this.value;
    }
  }

  toString() {
    try {
      return Big(this.value).toString();
    } catch (err) {
      console.error(err);
      return '-';
    }
  }

  toFixed(toFixedDigit) {
    try {
      return Big(this.value).toFixed(toFixedDigit);
    } catch (err) {
      console.error(err);
      return this.value.toString();
    }
  }
}

export default MathOp;
