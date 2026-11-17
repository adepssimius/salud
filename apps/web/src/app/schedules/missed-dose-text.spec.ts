import { MissedDoseState } from '@salud/shared/types';
import { MissedDoseHelpContext, adviceIsSkip, courseEffectHelp, instructionSummary, missedDoseActionHelp, missedDoseAdvice } from './missed-dose-text';

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

  // frontend.md → New schedule form → "If a dose is missed": what each choice does, per schedule-state.ts.
  describe('help text', () => {
    const ctx = (over: Partial<MissedDoseHelpContext> = {}): MissedDoseHelpContext => ({
      frequencyHours: 8,
      daily: false,
      endAfterOccurrences: null,
      hasEndDate: false,
      ...over,
    });

    it('says "count the next dose from then" moves every later dose back on an interval', () => {
      expect(missedDoseActionHelp('take_late_restart', ctx())).toBe(
        'The late dose restarts the clock: the next is due 8 hours after it, so every later dose moves back by however late it was.',
      );
      expect(missedDoseActionHelp('take_late_restart', ctx({ endAfterOccurrences: 10, hasEndDate: true }))).toContain(
        'The last dose moves back too; the end date stays, so a dose may fall past it and not be given.',
      );
    });

    it('says set times of day never move, even when the clock restarts', () => {
      const daily = ctx({ frequencyHours: null, daily: true });
      expect(missedDoseActionHelp('take_late_restart', daily)).toContain("The set times don't move: the next dose is the first set time after the late one");
      expect(missedDoseActionHelp(null, daily)).toBe('No advice — a missed dose just shows as missed. Whenever a dose is given, the next is due the first set time after it.');
    });

    it('says every other choice keeps the usual times', () => {
      expect(missedDoseActionHelp('take_late_keep_times', ctx())).toContain('Later doses stay at their usual times');
      expect(missedDoseActionHelp('skip', ctx())).toContain('later doses stay at their usual times');
      expect(missedDoseActionHelp('double_next', ctx())).toContain("Times don't move.");
      expect(missedDoseActionHelp('ask_prescriber', ctx())).toContain('Later doses keep their usual times.');
    });

    it('says what the course effect does for this kind of end, and that only skips count', () => {
      expect(courseEffectHelp('finish_every_dose', ctx({ hasEndDate: true }))).toBe(
        'Each skipped dose adds one at the end, so every dose is still given — past the end date if need be. Only skipped doses count here — a late dose is not skipped.',
      );
      expect(courseEffectHelp('end_on_date', ctx({ endAfterOccurrences: 10 }))).toContain('after 10 doses means 10 planned times, skipped ones included');
      expect(courseEffectHelp(null, ctx({ endAfterOccurrences: 10, hasEndDate: true }))).toContain(
        'Not specified: a course of 10 doses runs until 10 are given; an end date stays put.',
      );
    });
  });
});
