import { formatAge, isWeightStale, weightAgeDays, STALE_WEIGHT_DAYS } from './patient-display';

const now = new Date('2026-08-19T12:00:00');

describe('formatAge', () => {
  it('reads years and months for a child', () => {
    expect(formatAge('2022-05-19', now)).toBe('4y 3m');
  });

  it('drops the month part on a round birthday', () => {
    expect(formatAge('2020-08-19', now)).toBe('6y');
  });

  it('stays in months under two years, where months are how people speak', () => {
    expect(formatAge('2026-01-19', now)).toBe('7 months');
    expect(formatAge('2026-07-19', now)).toBe('1 month');
  });

  it('uses days then weeks for a newborn', () => {
    expect(formatAge('2026-08-16', now)).toBe('3 days');
    expect(formatAge('2026-08-01', now)).toBe('2 weeks');
  });

  it('returns null rather than NaN for missing or impossible dates', () => {
    expect(formatAge(null, now)).toBeNull();
    expect(formatAge('', now)).toBeNull();
    expect(formatAge('not-a-date', now)).toBeNull();
    expect(formatAge('2027-01-01', now)).toBeNull();
  });
});

describe('weight staleness', () => {
  const epoch = (d: string) => Math.floor(new Date(`${d}T12:00:00`).getTime() / 1000);

  it('treats a never-recorded weight as stale', () => {
    // No weight on file is exactly the case the dosing engine warns about.
    expect(isWeightStale(null, now)).toBe(true);
    expect(weightAgeDays(null, now)).toBeNull();
  });

  it('is fresh inside the threshold and stale past it', () => {
    expect(isWeightStale(epoch('2026-08-01'), now)).toBe(false);
    expect(isWeightStale(epoch('2026-01-01'), now)).toBe(true);
  });

  it('matches the API threshold exactly at the boundary', () => {
    const justInside = Math.floor(now.getTime() / 1000) - STALE_WEIGHT_DAYS * 86_400;
    expect(isWeightStale(justInside, now)).toBe(false);
    expect(isWeightStale(justInside - 86_400, now)).toBe(true);
  });

  it('reports the age in days', () => {
    expect(weightAgeDays(epoch('2026-08-09'), now)).toBe(10);
  });
});
