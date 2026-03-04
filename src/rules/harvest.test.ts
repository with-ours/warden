import { describe, it, expect } from 'vitest';
import { parseSince } from './harvest.js';

describe('parseSince', () => {
  it('parses ISO date strings', () => {
    const date = parseSince('2026-01-15');
    // Date constructor parses "2026-01-15" as UTC midnight.
    // Use UTC methods so the test doesn't depend on the local timezone.
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(0); // January
    expect(date.getUTCDate()).toBe(15);
  });

  it('parses day durations', () => {
    const before = Date.now();
    const date = parseSince('30d');
    const after = Date.now();

    // Should be ~30 days ago
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(date.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
    expect(date.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs + 1000);
  });

  it('parses week durations', () => {
    const before = Date.now();
    const date = parseSince('2w');
    const after = Date.now();

    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    expect(date.getTime()).toBeGreaterThanOrEqual(before - twoWeeksMs - 1000);
    expect(date.getTime()).toBeLessThanOrEqual(after - twoWeeksMs + 1000);
  });

  it('parses month durations', () => {
    const date = parseSince('3m');
    const now = new Date();
    const expected = new Date(now);
    expected.setMonth(expected.getMonth() - 3);

    // Within a day of expected (month arithmetic can vary)
    expect(Math.abs(date.getTime() - expected.getTime())).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseSince('foobar')).toThrow('Invalid --since value');
  });

  it('throws on empty string', () => {
    expect(() => parseSince('')).toThrow('Invalid --since value');
  });
});
