import { formatAge, isWeightStale, weightAgeDays } from './patient-display';

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
  const adult = '1985-03-02';
  const infant = '2026-06-19'; // two months old on `now`

  it('treats a never-recorded weight as stale', () => {
    // No weight on file is exactly the case the dosing engine warns about.
    expect(isWeightStale(null, adult, now)).toBe(true);
    expect(weightAgeDays(null, now)).toBeNull();
  });

  it('scales the threshold to the patient\'s age, as the API does', () => {
    // 90 days is fresh for an adult; 10 days is stale for a two-month-old.
    expect(isWeightStale(epoch('2026-05-21'), adult, now)).toBe(false);
    expect(isWeightStale(epoch('2026-08-09'), infant, now)).toBe(true);
    expect(isWeightStale(epoch('2026-08-14'), infant, now)).toBe(false);
  });

  it('treats a patient with no birth date as an adult', () => {
    expect(isWeightStale(epoch('2026-05-21'), null, now)).toBe(false);
    expect(isWeightStale(epoch('2025-01-01'), null, now)).toBe(true);
  });

  it('reports the age in days', () => {
    expect(weightAgeDays(epoch('2026-08-09'), now)).toBe(10);
  });
});
