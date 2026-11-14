import { describe, expect, it } from 'vitest';
import { moneyFromDecimal, moneyToDecimal, percentChange } from '../src/core/money.js';
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
  it('rejects garbage', () => {
    expect(() => moneyFromDecimal('1,000.00', 'USD')).toThrow();
    expect(() => moneyFromDecimal('10', 'US')).toThrow();
  });
  it('OTA DecimalPlaces', () => {
    expect(otaAmount('50000', '2', 'USD')).toEqual({ minor: 50000, currency: 'USD' });
    expect(otaAmount('500.00', '2', 'USD')).toEqual({ minor: 50000, currency: 'USD' });
    expect(otaAmount('5', '2', 'USD')).toEqual({ minor: 5, currency: 'USD' });
  });
  it('percent change', () => {
    expect(percentChange({ minor: 10000, currency: 'USD' }, { minor: 10250, currency: 'USD' })).toBeCloseTo(2.5);
  });
});
