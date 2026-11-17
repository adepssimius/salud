import { MissedDoseAction, MissedDoseCourseEffect, MissedDoseState } from '@salud/shared/types';

// The words for a schedule's missed-dose instruction (frontend.md → Schedules → "Missed doses").
// One module, so Home's overdue row, the schedule page and the dose form say the same thing. The
// instruction is what the prescriber or label said; these sentences repeat it, they never add to it
// (P6). With no instruction there is no advice at all — only that the dose is missed.

/** What the form offers, in the caregiver's words. Order is the form's. */
export const MISSED_DOSE_ACTION_LABELS: Record<MissedDoseAction, string> = {
  take_late_keep_times: 'Give it late, then keep the usual times',
  take_late_restart: 'Give it late, then count the next dose from then',
  skip: 'Skip it and give the next dose as usual',
  double_next: 'Take two next time',
  ask_prescriber: 'Ask the prescriber',
};

export const MISSED_DOSE_COURSE_EFFECT_LABELS: Record<MissedDoseCourseEffect, string> = {
  finish_every_dose: 'Give every dose — skipped doses are added to the end',
  end_on_date: 'End when planned — skipped doses are not made up',
};

/** "If a dose is missed: …" — the standing instruction, as the schedule page states it. */
export function instructionSummary(action: MissedDoseAction | null, cutoffHours: number | null): string | null {
  if (!action) return null;
  const base = MISSED_DOSE_ACTION_LABELS[action];
  const takeLate = action === 'take_late_keep_times' || action === 'take_late_restart';
  return takeLate && cutoffHours != null ? `${base} — but skip it if the next dose is within ${formatHours(cutoffHours)}` : base;
}

export function formatHours(h: number): string {
  const n = Math.round(h * 100) / 100;
  return n === 1 ? '1 hour' : `${n} hours`;
}

/**
 * What to do about the current missed dose, as one sentence, or null with no instruction. `when`
 * formats a time ("8:00 PM"); `contact` is the prescriber line for "ask the prescriber", when the
 * schedule's condition has one.
 */
export function missedDoseAdvice(missed: MissedDoseState, when: (sec: number) => string, contact?: string | null): string | null {
  const next = missed.nextSlotAt != null ? when(missed.nextSlotAt) : null;
  if (missed.pastCutoff) {
    return next ? `The next dose is due soon (${next}), so per the instruction: skip this one.` : 'Per the instruction: skip this one.';
  }
  switch (missed.action) {
    case 'take_late_keep_times':
      return next ? `Give it now, then the next dose at its usual time (${next}).` : 'Give it now.';
    case 'take_late_restart':
      return 'Give it now; the next dose is counted from when it is given.';
    case 'skip':
      return next ? `Skip this dose and give the next one as usual (${next}).` : 'Skip this dose.';
    case 'double_next':
      return next ? `Don't give it now — give a double dose at the next dose (${next}).` : "Don't give it now — give a double dose at the next dose.";
    case 'ask_prescriber':
      return contact ? `Ask the prescriber what to do — ${contact}.` : 'Ask the prescriber what to do.';
    default:
      return null;
  }
}

/** Whether the advice is to skip — the cue to put "Skip this dose" first. */
export function adviceIsSkip(missed: MissedDoseState): boolean {
  return missed.pastCutoff || missed.action === 'skip';
}
