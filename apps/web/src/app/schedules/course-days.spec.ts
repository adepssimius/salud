import { InterventionSchedule } from '@salud/shared/types';
import { endShift, plannedLastDose, sinceStart, untilDone } from './course-days';

const at = (d: number, h = 0) => Math.floor(new Date(2026, 10, d, h).getTime() / 1000);

function schedule(over: Partial<InterventionSchedule> = {}, courseEndsAt: number | null = null): InterventionSchedule {
  return {
    id: 's1',
    startAt: at(7, 12),
    frequencyHours: null,
    explicitTimes: ['08:00', '20:00'],
    endAfterOccurrences: 24,
    endAt: null,
    status: 'active',
    adherence: { expectedCount: 0, loggedCount: 0, skippedCount: 0, missed: 0, remainingOccurrences: null, overdue: false, courseEndsAt },
    ...over,
  } as InterventionSchedule;
}

describe('course-days', () => {
  it('plans the last dose at the N-th slot of a count course and the last slot by endAt of a date course', () => {
    // First slot Nov 7 20:00, 24 slots twice a day → Nov 19 08:00.
    expect(plannedLastDose(schedule())).toBe(at(19, 8));
    expect(plannedLastDose(schedule({ endAfterOccurrences: null, endAt: at(10, 12) }))).toBe(at(10, 8));
    expect(plannedLastDose(schedule({ endAfterOccurrences: null }))).toBeNull();
  });

  it('reports an end moved later by whole calendar days, and nothing when it stays on the planned day', () => {
    expect(endShift(schedule({}, at(20, 8)))).toEqual({ plannedAt: at(19, 8), endsAt: at(20, 8), days: 1 });
    expect(endShift(schedule({}, at(19, 20)))).toBeNull();
    expect(endShift(schedule({}, null))).toBeNull();
  });

  it('counts days since start and until the projected end', () => {
    const s = schedule({}, at(20, 8));
    expect(sinceStart(s, at(17, 13))).toEqual({ value: '10', label: 'days since start' });
    expect(untilDone(s, at(17, 13))).toEqual({ value: '3', label: 'days until done' });
    expect(untilDone(schedule({ endAfterOccurrences: null }), at(17, 13))).toBeNull();
  });
});
