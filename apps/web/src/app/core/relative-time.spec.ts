import { nextDoseLabel, relativeTime, timeAgo, timeUntil } from './relative-time';

const NOW = 1_800_000_000; // arbitrary fixed instant; every case passes it explicitly

describe('timeAgo', () => {
  it('produces the full granularity ladder', () => {
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(NOW - 45 * 60, NOW)).toBe('45m ago');
    expect(timeAgo(NOW - (2 * 3600 + 15 * 60), NOW)).toBe('2h 15m ago'); // the issue's own example
    expect(timeAgo(NOW - 3 * 3600, NOW)).toBe('3h ago');
    expect(timeAgo(NOW - 1 * 86400, NOW)).toBe('1 day ago');
    expect(timeAgo(NOW - 13 * 86400, NOW)).toBe('13 days ago');
    expect(timeAgo(NOW - 14 * 30 * 86400, NOW)).toBe('14 months ago'); // frontend.md:28's own example
    expect(timeAgo(NOW - 3 * 365 * 86400, NOW)).toBe('3 years ago');
  });

  it('holds at every ladder boundary, one second either side', () => {
    expect(timeAgo(NOW - 59, NOW)).toBe('just now');
    expect(timeAgo(NOW - 60, NOW)).toBe('1m ago');

    expect(timeAgo(NOW - 3599, NOW)).toBe('59m ago');
    expect(timeAgo(NOW - 3600, NOW)).toBe('1h ago');

    expect(timeAgo(NOW - 86399, NOW)).toBe('23h 59m ago');
    expect(timeAgo(NOW - 86400, NOW)).toBe('1 day ago');

    expect(timeAgo(NOW - 29 * 86400, NOW)).toBe('29 days ago');
    expect(timeAgo(NOW - 30 * 86400, NOW)).toBe('1 month ago');

    expect(timeAgo(NOW - 23 * 30 * 86400, NOW)).toBe('23 months ago');
    expect(timeAgo(NOW - 24 * 30 * 86400, NOW)).toBe('2 years ago');
  });

  it('suppresses a zero-minute remainder rather than printing "2h 0m ago"', () => {
    expect(timeAgo(NOW - 2 * 3600, NOW)).toBe('2h ago');
  });

  it('floors a future timestamp to "just now" instead of a negative duration', () => {
    expect(timeAgo(NOW + 5000, NOW)).toBe('just now');
  });

  it('defaults nowSeconds to the current time when omitted', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(timeAgo(nowSec - 30)).toBe('just now');
  });
});

describe('timeUntil', () => {
  it('produces the ladder for future moments', () => {
    expect(timeUntil(NOW + 30, NOW)).toBe('in less than a minute');
    expect(timeUntil(NOW + 6000, NOW)).toBe('in 1h 40m'); // the issue's countdown example
    expect(timeUntil(NOW + 3 * 86400, NOW)).toBe('in 3 days');
  });

  it('floors a past timestamp to "now"', () => {
    expect(timeUntil(NOW - 10, NOW)).toBe('now');
    expect(timeUntil(NOW, NOW)).toBe('now');
  });
});

describe('relativeTime', () => {
  it('picks the past form strictly before now, and the future form strictly after', () => {
    expect(relativeTime(NOW - 60, NOW)).toBe('1m ago');
    expect(relativeTime(NOW + 60, NOW)).toBe('in 1m');
  });

  it('reads as the past form at exactly now', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now');
  });
});

describe('nextDoseLabel', () => {
  it('passes null through unchanged — no guideline interval is not missing data', () => {
    expect(nextDoseLabel(null, NOW)).toBeNull();
  });

  it('reads as a countdown when the time is still ahead', () => {
    expect(nextDoseLabel(NOW + 6000, NOW)).toBe('next dose in 1h 40m');
  });

  it('reads "can give now" once the time has elapsed, never a negative duration', () => {
    expect(nextDoseLabel(NOW - 1, NOW)).toBe('can give now');
  });

  it('reads "can give now" at the exact instant, not "next dose now"', () => {
    expect(nextDoseLabel(NOW, NOW)).toBe('can give now');
  });
});
