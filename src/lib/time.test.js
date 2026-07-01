// src/lib/time.test.js
// Unit tests for the time/overtime math. Run with: npm test

import { startOfWeek, ymd, computeTotalHours, computeOvertime } from './time';

describe('startOfWeek', () => {
  test('returns the Monday 00:00 of the given week', () => {
    // 2026-06-24 is a Wednesday.
    const wed = new Date(2026, 5, 24, 15, 30, 0);
    const monday = startOfWeek(wed);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    // Same-week and not in the future relative to the input.
    const diffDays = (wed - monday) / 86400000;
    expect(diffDays).toBeGreaterThanOrEqual(0);
    expect(diffDays).toBeLessThan(7);
  });

  test('a Monday maps to itself (midnight)', () => {
    const mon = new Date(2026, 5, 22, 9, 0, 0); // Monday
    const start = startOfWeek(mon);
    expect(start.getDay()).toBe(1);
    expect(ymd(start)).toBe('2026-06-22');
  });
});

describe('ymd', () => {
  test('formats local date as YYYY-MM-DD with zero padding', () => {
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(ymd(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('computeTotalHours', () => {
  test('a straight 8-hour shift', () => {
    expect(
      computeTotalHours('2026-06-24T09:00:00', '2026-06-24T17:00:00')
    ).toBeCloseTo(8, 5);
  });

  test('subtracts a completed break', () => {
    expect(
      computeTotalHours(
        '2026-06-24T09:00:00',
        '2026-06-24T17:00:00',
        '2026-06-24T12:00:00',
        '2026-06-24T12:30:00'
      )
    ).toBeCloseTo(7.5, 5);
  });

  test('ignores an incomplete break (start but no end)', () => {
    expect(
      computeTotalHours('2026-06-24T09:00:00', '2026-06-24T17:00:00', '2026-06-24T12:00:00', null)
    ).toBeCloseTo(8, 5);
  });

  test('never returns negative hours', () => {
    expect(computeTotalHours('2026-06-24T17:00:00', '2026-06-24T09:00:00')).toBe(0);
  });
});

describe('computeOvertime', () => {
  test('hours over the weekly threshold', () => {
    expect(computeOvertime(45, 40)).toBeCloseTo(5, 5);
  });

  test('no overtime under the threshold', () => {
    expect(computeOvertime(30, 40)).toBe(0);
    expect(computeOvertime(40, 40)).toBe(0);
  });

  test('defaults to a 40-hour threshold', () => {
    expect(computeOvertime(42)).toBeCloseTo(2, 5);
  });
});
