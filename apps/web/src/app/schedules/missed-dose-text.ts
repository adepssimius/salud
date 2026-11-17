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

// ── What each choice does ────────────────────────────────────────────
// Helper text under the form's selects (frontend.md → New schedule form → "If a dose is missed"),
// and under the instruction on the schedule page. Every sentence follows schedule-state.ts:
//   - no instruction and "count the next dose from then" are the **restart** reading — the next
//     dose is one interval after the last dose given, or the next set time after it;
//   - every other instruction is the **grid** reading — the plan's own times, consumed in order;
//   - the course effect acts on skipped slots only; a late dose is not a skip.

/** What the help needs to know about the schedule being described. */
export interface MissedDoseHelpContext {
  /** Hours between doses for a strict interval; null for set times of day. */
  frequencyHours: number | null;
  /** Times of day rather than an interval. */
  daily: boolean;
  /** "End after N doses". */
  endAfterOccurrences: number | null;
  /** An end date is set. */
  hasEndDate: boolean;
}

function intervalPhrase(ctx: MissedDoseHelpContext): string {
  return ctx.frequencyHours ? formatHours(ctx.frequencyHours) : 'the set number of hours';
}

/** One or two sentences on what the chosen instruction (or none) does to the late dose, the later doses and the end. */
export function missedDoseActionHelp(action: MissedDoseAction | null, ctx: MissedDoseHelpContext): string {
  const countEnd = ctx.endAfterOccurrences != null;
  const restartNext = ctx.daily
    ? 'the first set time after it'
    : `${intervalPhrase(ctx)} after it`;
  switch (action) {
    case 'take_late_keep_times':
      return 'The late dose stands in for the one missed. Later doses stay at their usual times, so the next one may come sooner than usual.';
    case 'take_late_restart': {
      if (ctx.daily) {
        const tail = countEnd ? ' The course still gives every dose, so it may end later.' : '';
        return `The set times don't move: the next dose is the first set time after the late one, and any set time it ran past is not made up.${tail}`;
      }
      const ends = [
        countEnd ? 'the last dose moves back too' : null,
        ctx.hasEndDate ? 'the end date stays, so a dose may fall past it and not be given' : null,
      ].filter(Boolean);
      const tail = ends.length ? ` ${capitalise(ends.join('; '))}.` : '';
      return `The late dose restarts the clock: the next is due ${restartNext}, so every later dose moves back by however late it was.${tail}`;
    }
    case 'skip':
      return "Don't give the missed dose; later doses stay at their usual times. Tap Skip to record it.";
    case 'double_next':
      return "Don't give the missed dose; give a double at the next usual time (the dose form fills it in). Times don't move.";
    case 'ask_prescriber':
      return 'The app only says to ask the prescriber, with the condition’s contact when there is one. Later doses keep their usual times.';
    default:
      return `No advice — a missed dose just shows as missed. Whenever a dose is given, the next is due ${restartNext}.`;
  }
}

/** What the course effect (or none) does when doses are skipped, for this course's kind of end. */
export function courseEffectHelp(effect: MissedDoseCourseEffect | null, ctx: MissedDoseHelpContext): string {
  const n = ctx.endAfterOccurrences;
  let what: string;
  if (effect === 'finish_every_dose') {
    what = `Each skipped dose adds one at the end, so every dose is still given${ctx.hasEndDate ? ' — past the end date if need be' : ''}.`;
  } else if (effect === 'end_on_date') {
    what = `The course ends on time and skipped doses are not given${n != null ? ` — after ${n} doses means ${n} planned times, skipped ones included` : ''}.`;
  } else {
    const parts = [
      n != null ? `a course of ${n} doses runs until ${n} are given` : null,
      ctx.hasEndDate ? 'an end date stays put' : null,
    ].filter(Boolean);
    what = `Not specified: ${parts.join('; ')}.`;
  }
  return `${what} Only skipped doses count here — a late dose is not skipped.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
