import { concentrationText } from './concentration-display';

describe('concentrationText', () => {
  it('reads back the printed pair with the derived figure in parentheses', () => {
    expect(
      concentrationText({ concentrationMgPerMl: 32, concentrationMg: 160, concentrationVolumeMl: 5 }),
    ).toBe('160 mg / 5 mL (32 mg/mL)');
  });

  it('shows the per-mL figure alone when no printed pair was recorded', () => {
    expect(
      concentrationText({ concentrationMgPerMl: 25, concentrationMg: null, concentrationVolumeMl: null }),
    ).toBe('25 mg/mL');
  });

  // Backfilled rows are all "x mg per 1 mL"; spelling that out would pad every legacy row with a
  // parenthetical that repeats the number to its left.
  it('collapses a per-single-mL pair to the plain figure', () => {
    expect(
      concentrationText({ concentrationMgPerMl: 20, concentrationMg: 20, concentrationVolumeMl: 1 }),
    ).toBe('20 mg/mL');
  });

  it('is null for a form with no concentration at all', () => {
    expect(
      concentrationText({ concentrationMgPerMl: null, concentrationMg: null, concentrationVolumeMl: null }),
    ).toBeNull();
  });
});
