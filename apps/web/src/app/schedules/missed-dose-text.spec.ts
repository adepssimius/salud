import { MissedDoseState } from '@salud/shared/types';
import { adviceIsSkip, instructionSummary, missedDoseAdvice } from './missed-dose-text';

const when = (sec: number) => `T${sec}`;
const missed = (over: Partial<MissedDoseState> = {}): MissedDoseState => ({
  slotAt: 100,
  nextSlotAt: 200,
  action: null,
  pastCutoff: false,
  doubleNextDue: false,
  ...over,
});

describe('missed-dose text', () => {
  it('gives no advice without an instruction', () => {
    expect(missedDoseAdvice(missed(), when)).toBeNull();
    expect(instructionSummary(null, null)).toBeNull();
  });

  it('repeats each instruction, with the next dose time', () => {
    expect(missedDoseAdvice(missed({ action: 'take_late_keep_times' }), when)).toBe('Give it now, then the next dose at its usual time (T200).');
    expect(missedDoseAdvice(missed({ action: 'take_late_restart' }), when)).toBe('Give it now; the next dose is counted from when it is given.');
    expect(missedDoseAdvice(missed({ action: 'skip' }), when)).toBe('Skip this dose and give the next one as usual (T200).');
    expect(missedDoseAdvice(missed({ action: 'double_next', doubleNextDue: true }), when)).toBe(
      "Don't give it now — give a double dose at the next dose (T200).",
    );
    expect(missedDoseAdvice(missed({ action: 'ask_prescriber' }), when, 'Dr. Lee (pediatrician) 555-0100')).toBe(
      'Ask the prescriber what to do — Dr. Lee (pediatrician) 555-0100.',
    );
  });

  it('says to skip once a take-late dose is past its cutoff', () => {
    const m = missed({ action: 'take_late_keep_times', pastCutoff: true });
    expect(missedDoseAdvice(m, when)).toBe('The next dose is due soon (T200), so per the instruction: skip this one.');
    expect(adviceIsSkip(m)).toBe(true);
    expect(adviceIsSkip(missed({ action: 'take_late_keep_times' }))).toBe(false);
  });

  it('summarises the standing instruction, cutoff included', () => {
    expect(instructionSummary('take_late_keep_times', 2)).toBe('Give it late, then keep the usual times — but skip it if the next dose is within 2 hours');
    expect(instructionSummary('double_next', null)).toBe('Take two next time');
  });
});
