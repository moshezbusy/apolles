import { describe, expect, it } from 'vitest';
import { currencyExponent, exceedsTolerance, moneyFromDecimal, moneyToDecimal, percentChange } from '../src/core/money.js';
import { otaAmount } from '../src/adapters/ota/messages.js';

describe('money', () => {
  it('parses exactly without float errors', () => {
    expect(moneyFromDecimal('1234.5', 'usd')).toEqual({ minor: 123450, currency: 'USD' });
    expect(moneyFromDecimal('0.10', 'EUR').minor + moneyFromDecimal('0.20', 'EUR').minor).toBe(30);
    expect(moneyToDecimal({ minor: 5, currency: 'USD' })).toBe('0.05');
    expect(moneyToDecimal({ minor: 1500, currency: 'JPY' })).toBe('1500');
    expect(moneyToDecimal({ minor: 1234, currency: 'KWD' })).toBe('1.234');
  });
  it('never rounds a price silently', () => {
    expect(() => moneyFromDecimal('10.005', 'USD')).toThrow();
    expect(moneyFromDecimal('10.500', 'USD').minor).toBe(1050);
  });
  it('knows every currency without decimals, and the three-decimal ones', () => {
    for (const c of ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']) {
      expect(currencyExponent(c), c).toBe(0);
    }
    for (const c of ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) expect(currencyExponent(c), c).toBe(3);
    expect(currencyExponent('USD')).toBe(2);
    expect(moneyFromDecimal('1500000', 'PYG')).toEqual({ minor: 1500000, currency: 'PYG' }); // not 150,000,000
    expect(moneyToDecimal({ minor: 1500000, currency: 'VND' })).toBe('1500000');
    expect(() => moneyFromDecimal('1500.50', 'UGX')).toThrow();
  });
  it('refuses exponent notation and negative amounts', () => {
    expect(() => moneyFromDecimal('1e3', 'USD')).toThrow();
    expect(() => moneyFromDecimal(1e21, 'USD')).toThrow();
    expect(() => moneyFromDecimal(1e-7, 'USD')).toThrow();
    expect(() => moneyFromDecimal('-12', 'USD')).toThrow(/negative/i);
    expect(() => moneyFromDecimal(-5, 'USD')).toThrow(/negative/i);
    expect(() => moneyFromDecimal(Number.NaN, 'USD')).toThrow();
    expect(() => moneyFromDecimal(Number.POSITIVE_INFINITY, 'USD')).toThrow();
  });
  it('numbers are read through their exact decimal text, never float math', () => {
    expect(moneyFromDecimal(305.75, 'USD')).toEqual({ minor: 30575, currency: 'USD' });
    expect(moneyFromDecimal(17.1, 'USD').minor).toBe(1710);
    expect(() => moneyFromDecimal(0.1 + 0.2, 'USD')).toThrow(); // 0.30000000000000004: more precision than cents
  });
  it('rounds half-up only when asked, on the decimal digits', () => {
    const round = { round: 'half-up' } as const;
    expect(moneyFromDecimal('10.555', 'EUR', round).minor).toBe(1056);
    expect(moneyFromDecimal('10.554', 'EUR', round).minor).toBe(1055);
    expect(moneyFromDecimal('2.675', 'USD', round).minor).toBe(268); // float math says 267
    expect(moneyFromDecimal(1391.794, 'USD', round).minor).toBe(139179);
    expect(moneyFromDecimal(0.285, 'USD', round).minor).toBe(29);
    expect(moneyFromDecimal('1234.5', 'JPY', round).minor).toBe(1235);
    expect(moneyFromDecimal('0.999', 'USD', round).minor).toBe(100);
    expect(() => moneyFromDecimal('-0.285', 'USD', round)).toThrow();
  });
  it('rejects garbage', () => {
    expect(() => moneyFromDecimal('1,000.00', 'USD')).toThrow();
    expect(() => moneyFromDecimal('10', 'US')).toThrow();
  });
  it('OTA DecimalPlaces', () => {
    expect(otaAmount('50000', '2', 'USD')).toEqual({ minor: 50000, currency: 'USD' });
    expect(otaAmount('500.00', '2', 'USD')).toEqual({ minor: 50000, currency: 'USD' });
    expect(otaAmount('5', '2', 'USD')).toEqual({ minor: 5, currency: 'USD' });
  });
  it('price tolerance is exact whole-number math', () => {
    const usd = (minor: number) => ({ minor, currency: 'USD' });
    expect(exceedsTolerance(usd(10000), usd(10700), 7)).toBe(false); // exactly 7 %: float math said 7.000000000000001
    expect(exceedsTolerance(usd(10000), usd(10701), 7)).toBe(true);
    expect(exceedsTolerance(usd(10000), usd(10000), 0)).toBe(false);
    expect(exceedsTolerance(usd(10000), usd(10001), 0)).toBe(true);
    expect(exceedsTolerance(usd(10000), usd(9000), 0)).toBe(false);
    expect(exceedsTolerance(usd(10000), usd(10250), 2.5)).toBe(false);
    expect(exceedsTolerance(usd(10000), usd(10251), 2.5)).toBe(true);
    expect(exceedsTolerance(usd(0), usd(1), 50)).toBe(true);
    expect(() => exceedsTolerance(usd(100), usd(101), Number.NaN)).toThrow();
    expect(() => exceedsTolerance(usd(100), { minor: 101, currency: 'EUR' }, 1)).toThrow();
  });
  it('percent change', () => {
    expect(percentChange({ minor: 10000, currency: 'USD' }, { minor: 10250, currency: 'USD' })).toBeCloseTo(2.5);
  });
});
