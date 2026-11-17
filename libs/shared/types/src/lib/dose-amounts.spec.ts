import {
  deriveAmountMg,
  formatPillCount,
  mgFromMl,
  mgFromPills,
  mlFromMg,
  pillsFromMg,
  splitPillCount,
  toDrawableMl,
} from './dose-amounts';

describe('dose amounts', () => {
  it('converts mL to mg to the cent, and mg to a drawable mL', () => {
    expect(mgFromMl(10, 32)).toBe(320);
    expect(mgFromMl(0.3, 0.1)).toBe(0.03);
    expect(mlFromMg(320, 32)).toBe(10);
    expect(mlFromMg(174, 32)).toBe(5.4); // 5.4375 → nearest 0.1 at or above 1 mL
    expect(mlFromMg(13, 32)).toBe(0.4); // 0.406 → nearest 0.05 below 1 mL
    expect(toDrawableMl(0.33)).toBe(0.35);
  });

  it('returns null without a usable concentration or strength', () => {
    expect(mgFromMl(10, null)).toBeNull();
    expect(mgFromMl(10, 0)).toBeNull();
    expect(mlFromMg(100, undefined)).toBeNull();
    expect(mgFromPills(1, null)).toBeNull();
    expect(pillsFromMg(250, null)).toBeNull();
    expect(mgFromMl(null, 32)).toBeNull();
  });

  it('converts pills and mg both ways, with partial pills', () => {
    expect(mgFromPills(1 / 3, 500)).toBe(166.67);
    expect(mgFromPills(1.5, 500)).toBe(750);
    expect(pillsFromMg(750, 500)).toBe(1.5);
    expect(pillsFromMg(125, 500)).toBe(0.25);
    expect(pillsFromMg(166.67, 500)).toBeCloseTo(1 / 3, 10);
    expect(pillsFromMg(1000, 500)).toBe(2);
  });

  it('refuses to snap mg to a pill count that would misstate the dose', () => {
    expect(pillsFromMg(320, 500)).toBeNull(); // 0.64 — between ½ and ⅔
  });

  it('splits and formats a pill count', () => {
    expect(splitPillCount(1.5)).toEqual({ whole: 1, fraction: 0.5 });
    expect(splitPillCount(2 / 3)).toEqual({ whole: 0, fraction: 2 / 3 });
    expect(splitPillCount(0.4)).toBeNull();
    expect(formatPillCount(1.5)).toBe('1 ½');
    expect(formatPillCount(1 / 3)).toBe('⅓');
    expect(formatPillCount(2)).toBe('2');
    expect(formatPillCount(2.75)).toBe('2 ¾');
    expect(formatPillCount(0.4)).toBe('0.4');
  });

  it('derives mg from mL first, then pills, and nothing without an embodiment', () => {
    const liquid = { concentrationMgPerMl: 32, strengthMgPerUnit: null };
    const tablet = { concentrationMgPerMl: null, strengthMgPerUnit: 500 };
    expect(deriveAmountMg(liquid, { amountMl: 10 })).toBe(320);
    expect(deriveAmountMg(tablet, { amountMl: 10, pillCount: 0.5 })).toBe(250);
    expect(deriveAmountMg({ concentrationMgPerMl: null, strengthMgPerUnit: null }, { amountMl: 3 })).toBeNull();
    expect(deriveAmountMg(null, { amountMl: 10 })).toBeNull();
  });
});
