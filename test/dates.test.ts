import { describe, expect, it } from 'vitest';
import { conservativeDeadline, earliestStartOfLocalDay } from '../src/core/dates.js';

describe('deadlines without a time zone', () => {
  it('a date-time with an offset is taken exactly', () => {
    expect(conservativeDeadline('2027-02-25T23:59:00+01:00')).toBe('2027-02-25T22:59:00.000Z');
    expect(conservativeDeadline('2027-02-25T12:00:00Z')).toBe('2027-02-25T12:00:00.000Z');
    expect(conservativeDeadline('2027-02-25T12:00:00-0500')).toBe('2027-02-25T17:00:00.000Z');
  });
  it('without an offset: the earliest moment that calendar day can start anywhere (00:00 at UTC+14)', () => {
    // Read as UTC this would be 2027-05-12T00:00Z: for a hotel east of UTC the real deadline is earlier.
    expect(conservativeDeadline('2027-05-12T00:00:00')).toBe('2027-05-11T10:00:00.000Z');
    expect(conservativeDeadline('2027-05-12T18:30:00')).toBe('2027-05-11T10:00:00.000Z');
    expect(conservativeDeadline('2027-05-12')).toBe('2027-05-11T10:00:00.000Z');
    expect(earliestStartOfLocalDay('2027-03-01')).toBe('2027-02-28T10:00:00.000Z');
  });
  it('never later than the real deadline, wherever the hotel is', () => {
    const shown = Date.parse(conservativeDeadline('2027-05-12T00:00:00')!);
    for (let offsetHours = -12; offsetHours <= 14; offsetHours++) {
      const real = Date.parse('2027-05-12T00:00:00Z') - offsetHours * 3_600_000;
      expect(shown).toBeLessThanOrEqual(real);
    }
  });
  it('something that is not a date gives nothing', () => {
    expect(conservativeDeadline('soon')).toBeUndefined();
    expect(conservativeDeadline('2027-02-30')).toBeUndefined();
    expect(conservativeDeadline('2027-13-01T00:00:00')).toBeUndefined();
    expect(conservativeDeadline(undefined)).toBeUndefined();
  });
});
