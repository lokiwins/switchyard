import { describe, expect, it } from 'vitest';
import { isDue, timeAgo } from './time';

describe('isDue', () => {
  it('shows an alert set for a time from then on; one with no time never', () => {
    expect(isDue(1000, 999)).toBe(false);
    expect(isDue(1000, 1000)).toBe(true);
    expect(isDue(1000, 5000)).toBe(true);
    for (const none of [null, undefined, 0]) expect(isDue(none, 5000)).toBe(false);
  });
});

describe('timeAgo', () => {
  it('says how long ago, in the largest whole unit', () => {
    const now = 10 * 24 * 3_600_000;
    expect(timeAgo(null, now)).toBe('—');
    expect(timeAgo(now - 30_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 24 * 3_600_000, now)).toBe('2d ago');
  });
});
