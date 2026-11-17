import { InterventionSchedule, TimelineEntry } from '@salud/shared/types';
import { buildLog, countsToward, dayStrip, isLinkCandidate, localDayKey, scheduleProgress, scheduleSlots } from './episode-course';

// Local-time fixtures: every test builds its instants with `new Date(y, m, d, h)` so the day
// boundaries are the test machine's own, whatever zone CI runs in.
const at = (d: number, h = 0, min = 0) => Math.floor(new Date(2026, 10, d, h, min).getTime() / 1000);

function schedule(over: Partial<InterventionSchedule> = {}): InterventionSchedule {
  return {
    id: 's1',
    patientId: 'p1',
    type: 'medication_dose',
    medicationId: 'cream',
    medicationEmbodimentId: 'emb',
    episodeId: 'ep1',
    conditionId: null,
    label: 'Clotrimazole twice daily',
    doseMg: null,
    doseMl: null,
    pillCount: null,
    bodyLocation: null,
    side: null,
    dressingType: null,
    frequencyHours: null,
    explicitTimes: ['08:00', '20:00'],
    startAt: at(2, 8),
    endAfterOccurrences: null,
    endAt: null,
    notes: null,
    status: 'active',
    nextDueAt: null,
    createdByUserId: 'u1',
    createdAt: at(2, 8),
    updatedAt: at(2, 8),
    adherence: { expectedCount: 0, loggedCount: 0, missed: 0, remainingOccurrences: null, overdue: false },
    ...over,
  };
}

let seq = 0;
function dose(ts: number, over: { medicationId?: string; scheduleId?: string | null; isAtypical?: boolean; type?: string } = {}): TimelineEntry {
  const type = over.type ?? 'medication_dose';
  return {
    id: `d${++seq}`,
    kind: 'intervention',
    type,
    timestamp: ts,
    recordedBy: null,
    display: {
      type,
      scheduleId: over.scheduleId ?? null,
      metadata: { medicationId: over.medicationId ?? 'cream', medicationEmbodimentId: 'emb', isAtypical: !!over.isAtypical },
    } as any,
  };
}

function obs(ts: number): TimelineEntry {
  return { id: `o${++seq}`, kind: 'observation', type: 'observation', timestamp: ts, recordedBy: null, display: { entries: [] } as any };
}

describe('scheduleSlots', () => {
  it('lays fixed-time slots on local days from startAt, capped at endAfterOccurrences', () => {
    const s = schedule({ endAfterOccurrences: 3 });
    expect(scheduleSlots(s, at(1), at(10))).toEqual([at(2, 8), at(2, 20), at(3, 8)]);
  });

  it('stops interval slots at endAt', () => {
    const s = schedule({ explicitTimes: null, frequencyHours: 12, endAt: at(3, 8) });
    expect(scheduleSlots(s, at(1), at(10))).toEqual([at(2, 8), at(2, 20), at(3, 8)]);
  });

  it('skips a fixed slot earlier on the start day than startAt', () => {
    const s = schedule({ startAt: at(2, 12) });
    expect(scheduleSlots(s, at(2), at(3) - 1)).toEqual([at(2, 20)]);
  });
});

describe('countsToward and isLinkCandidate', () => {
  const s = schedule({ endAt: at(5) });
  it('counts only a dose linked to the schedule', () => {
    expect(countsToward(s, dose(at(3, 9), { scheduleId: 's1' }))).toBe(true);
    expect(countsToward(s, dose(at(3, 9)))).toBe(false);
    expect(countsToward(s, dose(at(3, 9), { scheduleId: 's2' }))).toBe(false);
  });
  it('offers an unlinked dose of the same medicine in the window as a link candidate, nothing else', () => {
    expect(isLinkCandidate(s, dose(at(3, 9)))).toBe(true);
    expect(isLinkCandidate(s, dose(at(3, 9), { scheduleId: 's1' }))).toBe(false);
    expect(isLinkCandidate(s, dose(at(3, 9), { medicationId: 'other' }))).toBe(false);
    expect(isLinkCandidate(s, dose(at(1, 9)))).toBe(false);
    expect(isLinkCandidate(s, dose(at(6, 9)))).toBe(false);
  });
});

describe('scheduleProgress', () => {
  it('counts linked doses, names the unlinked ones, reports short doses, and takes next due from the schedule', () => {
    const s = schedule({ endAfterOccurrences: 28, nextDueAt: at(4, 20) });
    const entries = [dose(at(2, 8), { scheduleId: 's1' }), dose(at(2, 21)), dose(at(3, 8, 30))];
    const p = scheduleProgress(s, entries, at(4, 9));
    // Due: 2d 8, 2d 20, 3d 8, 3d 20, 4d 8 = 5
    expect(p).toMatchObject({ given: 1, unlinked: 2, due: 5, short: 4, doses: { given: 1, total: 28 }, days: null, state: 'active' });
    expect(p.nextDueAt).toBe(at(4, 20));
  });

  it('reports skipped slots apart from doses given', () => {
    const s = schedule({ adherence: { expectedCount: 4, loggedCount: 3, skippedCount: 1, missed: 0, remainingOccurrences: null, overdue: false, courseEndsAt: null } });
    expect(scheduleProgress(s, [dose(at(2, 8), { scheduleId: 's1' })], at(4, 7))).toMatchObject({ given: 1, skipped: 1 });
  });

  it('reports day N of M for a course with an end date', () => {
    const s = schedule({ endAt: at(15, 20) });
    expect(scheduleProgress(s, [], at(10, 9)).days).toEqual({ day: 9, total: 14 });
  });

  it('is complete once every dose of the course is given, with nothing due next', () => {
    const s = schedule({ endAfterOccurrences: 2 });
    const p = scheduleProgress(s, [dose(at(2, 8), { scheduleId: 's1' }), dose(at(2, 20), { scheduleId: 's1' })], at(3, 9));
    expect(p.state).toBe('complete');
    expect(p.nextDueAt).toBeNull();
    expect(p.due).toBe(2);
  });

  it('has no next due time while paused', () => {
    const p = scheduleProgress(schedule({ status: 'paused' }), [], at(3, 9));
    expect(p.state).toBe('paused');
    expect(p.nextDueAt).toBeNull();
  });
});

describe('dayStrip', () => {
  it('without a schedule shows plain counts and never judges a day', () => {
    const cells = dayStrip(at(2, 7), null, [], [dose(at(2, 9)), dose(at(2, 21)), obs(at(3, 9))], at(4, 12));
    expect(cells.map((c) => [c.dayNumber, c.count, c.expected, c.short])).toEqual([
      [1, 2, null, false],
      [2, 0, null, false],
      [3, 0, null, false],
    ]);
    expect(cells[2].isToday).toBe(true);
  });

  it('with a schedule marks past short days, and not today while a slot is still to come', () => {
    const s = schedule();
    const linked = { scheduleId: 's1' };
    // The unlinked dose on the 3rd does not count: only linked doses do.
    const entries = [dose(at(2, 8), linked), dose(at(2, 20), linked), dose(at(3, 8), linked), dose(at(3, 20)), dose(at(4, 8), linked)];
    const cells = dayStrip(at(1, 18), null, [s], entries, at(4, 12));
    expect(cells.map((c) => [localDayKey(c.dayStart).slice(-2), c.count, c.expected, c.short])).toEqual([
      ['01', 0, null, false], // before the schedule: nothing expected, no judgement
      ['02', 2, 2, false],
      ['03', 1, 2, true],
      ['04', 1, 2, false], // today, 20:00 still to come
    ]);
  });

  it('a skipped slot covers its day', () => {
    const entries = [dose(at(2, 8), { scheduleId: 's1' })];
    const cells = dayStrip(at(2, 7), null, [schedule()], entries, at(3, 12), new Map([['s1', [at(2, 20)]]]));
    expect(cells[0]).toMatchObject({ count: 1, expected: 2, skipped: 1, short: false });
  });

  it('marks today short once no slot is left', () => {
    const cells = dayStrip(at(2, 7), null, [schedule()], [dose(at(2, 8), { scheduleId: 's1' })], at(2, 22));
    expect(cells[0]).toMatchObject({ count: 1, expected: 2, short: true, isToday: true });
  });
});

describe('buildLog', () => {
  const none = () => false;
  it('folds consecutive days of the same routine dose into one run, newest first', () => {
    const items = buildLog([obs(at(2, 9)), dose(at(3, 8)), dose(at(3, 20)), dose(at(4, 8)), dose(at(5, 8))], none);
    expect(items.map((i) => i.kind)).toEqual(['run', 'day']);
    const run = items[0] as Extract<(typeof items)[number], { kind: 'run' }>;
    expect(run.count).toBe(4);
    expect(run.days.map((d) => d.key.slice(-2))).toEqual(['05', '04', '03']);
    expect(run.first).toBe(at(3, 8));
    expect(run.last).toBe(at(5, 8));
  });

  it('keeps a lone routine day, an atypical dose, and the episode start as days of their own', () => {
    const start = dose(at(2, 8));
    const items = buildLog([start, dose(at(3, 8)), dose(at(4, 8), { isAtypical: true }), dose(at(5, 8))], (e) => e === start);
    expect(items.map((i) => i.kind)).toEqual(['day', 'day', 'day', 'day']);
  });
});
