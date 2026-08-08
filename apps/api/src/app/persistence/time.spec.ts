import { normalizeTs, toDate } from './time';

// A pure-function spec rather than an e2e one, because the e2e suite cannot see this module's
// failure mode: nothing asserts a timestamp's *type*, and the assertions that exist either compare
// two endpoint values (which would regress together) or use toBeGreaterThan(0) — which a leaked Date
// passes via valueOf. These are the three cases the 14 copies disagreed about.
describe('normalizeTs', () => {
  it('converts a Date to epoch seconds, flooring sub-second precision', () => {
    expect(normalizeTs(new Date('2026-08-01T10:00:00.000Z'))).toBe(1785578400);
    expect(normalizeTs(new Date('2026-08-01T10:00:00.999Z'))).toBe(1785578400);
  });

  it('passes an already-normalized number through unchanged', () => {
    // timeline.service.ts re-normalizes a value patients.service.ts already converted, so the
    // passthrough branch is reachable in production and this is not a hypothetical.
    expect(normalizeTs(1785578400)).toBe(1785578400);
  });

  it('maps both null and undefined to null', () => {
    // The medications copy lacked this guard and returned undefined for undefined. Its columns are
    // NOT NULL so nothing depended on it, but the shared version has to answer for every caller.
    expect(normalizeTs(null)).toBeNull();
    expect(normalizeTs(undefined)).toBeNull();
  });

  it('keeps epoch 0 as 0 rather than collapsing it to null', () => {
    // observations.service.ts guarded on truthiness, which turned a 0 into null — i.e. "no weight
    // ever recorded". That would let a backdated 1969 weight overwrite a 1970 one, which is exactly
    // what the guard there exists to prevent.
    expect(normalizeTs(0)).toBe(0);
    expect(normalizeTs(new Date(0))).toBe(0);
  });
});

describe('toDate', () => {
  it('converts epoch seconds to a Date', () => {
    expect(toDate(1785578400)).toEqual(new Date('2026-08-01T10:00:00.000Z'));
  });

  it('passes an existing Date through untouched', () => {
    const d = new Date('2026-08-01T10:00:00.000Z');
    expect(toDate(d)).toBe(d);
  });

  it('maps null and undefined to null rather than the epoch', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });

  it('round-trips with normalizeTs', () => {
    const ts = 1785578400;
    expect(normalizeTs(toDate(ts))).toBe(ts);
    const d = new Date('2026-08-01T10:00:00.000Z');
    expect(toDate(normalizeTs(d))).toEqual(d);
  });
});
