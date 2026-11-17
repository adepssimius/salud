import { defaultDailyTimes, frequencyPhrase, scheduleName } from './schedule-name';

describe('scheduleName', () => {
  const tablet = { label: '500 mg tablet', dosageForm: 'tablet' as const, unitType: 'tablet' as const };
  const liquid = { label: '160 mg/5 mL', dosageForm: 'liquid' as const, unitType: 'ml' as const };
  const cream = { label: '1% cream', dosageForm: 'cream' as const, unitType: 'other' as const };

  it("reads like the owner's example for a tablet", () => {
    expect(scheduleName({ type: 'medication_dose', medicationName: 'acetaminophen', embodiment: tablet, doseMg: 500, pillCount: 1, frequencyHours: 6 })).toBe(
      '500 mg Acetaminophen q6h',
    );
  });

  it('gives a liquid its mL beside the mg', () => {
    expect(scheduleName({ type: 'medication_dose', medicationName: 'acetaminophen', embodiment: liquid, doseMg: 160, doseMl: 5, frequencyHours: 6 })).toBe(
      '160 mg (5 mL) Acetaminophen q6h',
    );
  });

  it('leaves a stray mL out of a tablet\'s name', () => {
    expect(scheduleName({ type: 'medication_dose', medicationName: 'acetaminophen', embodiment: tablet, doseMg: 320, doseMl: 10, frequencyHours: 6 })).toBe(
      '320 mg Acetaminophen q6h',
    );
  });

  it('names a cream by its embodiment, with no amount', () => {
    expect(scheduleName({ type: 'medication_dose', medicationName: 'clotrimazole', embodiment: cream, frequencyHours: 12 })).toBe('Clotrimazole 1% cream q12h');
    expect(scheduleName({ type: 'medication_dose', medicationName: 'clotrimazole', embodiment: cream, explicitTimes: ['20:00', '08:00'] })).toBe(
      'Clotrimazole 1% cream BID (08:00, 20:00)',
    );
  });

  it('uses nurse shorthand for fixed times and daily for every 24 h', () => {
    expect(frequencyPhrase(null, ['08:00'])).toBe('daily (08:00)');
    expect(frequencyPhrase(null, ['08:00', '14:00', '20:00'])).toBe('TID (08:00, 14:00, 20:00)');
    expect(frequencyPhrase(null, ['06:00', '12:00', '18:00', '00:00'])).toBe('QID (00:00, 06:00, 12:00, 18:00)');
    expect(frequencyPhrase(null, ['01:00', '02:00', '03:00', '04:00', '05:00'])).toBe('at 01:00, 02:00, 03:00, 04:00, 05:00');
    expect(frequencyPhrase(24, null)).toBe('daily');
    expect(frequencyPhrase(1.5, null)).toBe('q1.5h');
    expect(frequencyPhrase(null, null)).toBe('');
  });

  it('names a dressing change by where it is', () => {
    expect(scheduleName({ type: 'dressing_change', bodyLocation: 'knee', side: 'left', frequencyHours: 24 })).toBe('Dressing change, left knee daily');
    expect(scheduleName({ type: 'dressing_change', bodyLocation: 'left knee', side: 'left', frequencyHours: 24 })).toBe('Dressing change, left knee daily');
    expect(scheduleName({ type: 'dressing_change', bodyLocation: 'abdomen', side: 'n/a', frequencyHours: 12 })).toBe('Dressing change, abdomen q12h');
  });

  it('leaves out what the form has no value for', () => {
    expect(scheduleName({ type: 'medication_dose', medicationName: 'amoxicillin', frequencyHours: 8 })).toBe('Amoxicillin q8h');
    expect(scheduleName({ type: 'medication_dose', medicationName: 'amoxicillin' })).toBe('Amoxicillin');
    expect(scheduleName({ type: 'medication_dose', medicationName: '' })).toBe('');
    expect(scheduleName({ type: 'medication_dose', medicationName: 'ibuprofen', pillCount: 2, embodiment: tablet })).toBe('2 tablets Ibuprofen');
  });
});

describe('defaultDailyTimes', () => {
  it('spreads N doses across the waking day', () => {
    expect(defaultDailyTimes(0)).toEqual([]);
    expect(defaultDailyTimes(1)).toEqual(['08:00']);
    expect(defaultDailyTimes(2)).toEqual(['08:00', '20:00']);
    expect(defaultDailyTimes(3)).toEqual(['08:00', '14:00', '20:00']);
    expect(defaultDailyTimes(4)).toEqual(['08:00', '12:00', '16:00', '20:00']);
    expect(defaultDailyTimes(5)).toEqual(['08:00', '11:00', '14:00', '17:00', '20:00']);
  });
});
