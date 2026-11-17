import { ADULT_STALE_WEIGHT_DAYS, staleWeightThresholdDays, weightStaleness } from './weight-staleness';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const epoch = (iso: string) => Math.floor(at(iso).getTime() / 1000);

describe('staleWeightThresholdDays', () => {
  // Born 2026-01-15; each pair is the last day of one tier and the first day of the next.
  const dob = '2026-01-15';
  it.each([
    ['2026-01-15', 7], // newborn
    ['2026-04-14', 7], // 2 months 30 days — still under 3 months
    ['2026-04-15', 14], // exactly 3 months
    ['2026-07-14', 14],
    ['2026-07-15', 30], // 6 months
    ['2027-01-14', 30], // 11 months
    ['2027-01-15', 60], // 1st birthday
    ['2028-01-14', 60],
    ['2028-01-15', 90], // 2nd birthday
    ['2031-01-14', 90],
    ['2031-01-15', 180], // 5th birthday
    ['2044-01-14', 180], // day before 18
    ['2044-01-15', 365], // 18th birthday
    ['2090-06-01', 365],
  ])('born 2026-01-15, checked %s → %i days', (when, days) => {
    expect(staleWeightThresholdDays(dob, at(when))).toBe(days);
  });

  it('treats a missing, unreadable or future birth date as an adult', () => {
    expect(staleWeightThresholdDays(null, at('2026-06-01'))).toBe(ADULT_STALE_WEIGHT_DAYS);
    expect(staleWeightThresholdDays(undefined, at('2026-06-01'))).toBe(ADULT_STALE_WEIGHT_DAYS);
    expect(staleWeightThresholdDays('', at('2026-06-01'))).toBe(ADULT_STALE_WEIGHT_DAYS);
    expect(staleWeightThresholdDays('not a date', at('2026-06-01'))).toBe(ADULT_STALE_WEIGHT_DAYS);
    expect(staleWeightThresholdDays('2027-01-01', at('2026-06-01'))).toBe(ADULT_STALE_WEIGHT_DAYS);
  });

  it('judges age at the moment of the check, not today', () => {
    // The same 13-month-old was 11 months old at a backdated dose two months ago.
    expect(staleWeightThresholdDays('2025-10-01', at('2026-11-01'))).toBe(60);
    expect(staleWeightThresholdDays('2025-10-01', at('2026-09-01'))).toBe(30);
  });
});

describe('weightStaleness', () => {
  it('always flags a weight that was never recorded', () => {
    expect(weightStaleness(null, '1980-01-01', at('2026-06-01'))).toEqual({
      stale: true,
      daysSince: null,
      thresholdDays: 365,
    });
  });

  it('is fresh at the threshold and stale one day past it', () => {
    const now = at('2026-06-01');
    const adult = '1980-01-01';
    expect(weightStaleness(epoch('2026-06-01') - 365 * 86_400, adult, now)).toMatchObject({ stale: false, daysSince: 365 });
    expect(weightStaleness(epoch('2026-06-01') - 366 * 86_400, adult, now)).toMatchObject({ stale: true, daysSince: 366 });
  });

  it('leaves an adult with a 90-day-old weight alone and flags a 2-month-old with a 10-day-old one', () => {
    const now = at('2026-06-01');
    expect(weightStaleness(epoch('2026-03-03'), '1985-05-05', now).stale).toBe(false);
    expect(weightStaleness(epoch('2026-05-22'), '2026-04-01', now).stale).toBe(true);
  });
});
