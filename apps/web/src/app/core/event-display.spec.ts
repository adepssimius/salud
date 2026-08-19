import {
  CANONICAL_UNITS,
  convertTemp,
  describeEvent,
  entrySummary,
  fromCm,
  fromKg,
  labSummary,
  photoFileIds,
  unitsFor,
} from './event-display';
import { TimelineEntry } from '@salud/shared/types';

const IMPERIAL = { temp: 'F' as const, weight: 'lb' as const, length: 'in' as const };

describe('event-display conversions', () => {
  it('converts temperature both ways and leaves same-unit values alone', () => {
    expect(convertTemp(38.4, 'C', 'F')).toBe(101.1);
    expect(convertTemp(101.2, 'F', 'C')).toBe(38.4);
    expect(convertTemp(38.4, 'C', 'C')).toBe(38.4);
  });

  it('converts canonical kg and cm to the display unit', () => {
    expect(fromKg(11.34, 'lb')).toBe(25);
    expect(fromKg(11.34, 'kg')).toBe(11.34);
    expect(fromKg(12.7, 'st')).toBe(2);
    expect(fromCm(91.4, 'in')).toBe(36);
    expect(fromCm(91.4, 'cm')).toBe(91.4);
  });

  it('falls back to canonical units when there is no signed-in viewer', () => {
    // The public /brief/:token route has no user — it must not assume one.
    expect(unitsFor(null)).toEqual(CANONICAL_UNITS);
    expect(unitsFor(undefined)).toEqual(CANONICAL_UNITS);
    expect(unitsFor({ preferredTempUnit: 'F', preferredWeightUnit: 'lb', preferredLengthUnit: 'in' } as any)).toEqual(
      IMPERIAL,
    );
  });
});

describe('entrySummary', () => {
  it('never emits raw JSON for any entry type', () => {
    const samples = [
      { type: 'temperature', metadata: { value: 38.1, unit: 'C', method: 'oral' } },
      { type: 'heart_rate', metadata: { bpm: 120 } },
      { type: 'respiratory_rate', metadata: { breathsPerMin: 24 } },
      { type: 'oxygen_saturation', metadata: { percent: 97 } },
      { type: 'pain_score', metadata: { score: 7 } },
      { type: 'weight', metadata: { kg: 11.34 } },
      { type: 'height', metadata: { cm: 91.4 } },
      { type: 'lesion_size', metadata: { lengthCm: 2, widthCm: 1.5, depthCm: null, bodyLocation: 'left forearm', side: 'left' } },
      { type: 'symptom', metadata: { tag: 'cough', severity: 'moderate' } },
      { type: 'tag', metadata: { tag: 'cough' } },
      { type: 'note', metadata: { text: 'slept badly' } },
      { type: 'photo', metadata: { fileId: 'f1', bodyLocation: 'back', side: 'n/a' } },
      { type: 'lab_result', metadata: { analyte: 'FERRITIN', valueText: '37', unit: 'ng/mL', flag: 'L' } },
      { type: 'document', metadata: { fileId: 'f2', label: 'Quest labs' } },
    ];
    for (const s of samples) {
      const out = entrySummary(s);
      expect(out).not.toContain('{');
      expect(out).not.toContain('"');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('formats a temperature in the viewer preferred unit, converting from how it was recorded', () => {
    const celsiusEntry = { type: 'temperature', metadata: { value: 38.4, unit: 'C', method: 'oral' } };
    expect(entrySummary(celsiusEntry, IMPERIAL)).toBe('Temp 101.1 °F (oral)');
    expect(entrySummary(celsiusEntry, CANONICAL_UNITS)).toBe('Temp 38.4 °C (oral)');

    // Recorded in F: shown as-is for an F viewer, converted for a C viewer.
    const fahrenheitEntry = { type: 'temperature', metadata: { value: 101.2, unit: 'F', method: 'temporal' } };
    expect(entrySummary(fahrenheitEntry, IMPERIAL)).toBe('Temp 101.2 °F (temporal)');
    expect(entrySummary(fahrenheitEntry, CANONICAL_UNITS)).toBe('Temp 38.4 °C (temporal)');
  });

  it('omits an unknown temperature method', () => {
    expect(entrySummary({ type: 'temperature', metadata: { value: 38, unit: 'C', method: 'unknown' } })).toBe(
      'Temp 38 °C',
    );
  });

  it('converts weight, height and lesion dimensions to the display unit', () => {
    expect(entrySummary({ type: 'weight', metadata: { kg: 11.34 } }, IMPERIAL)).toBe('25 lb');
    expect(entrySummary({ type: 'weight', metadata: { kg: 11.34 } })).toBe('11.34 kg');
    expect(entrySummary({ type: 'height', metadata: { cm: 91.4 } }, IMPERIAL)).toBe('36 in');
    expect(
      entrySummary(
        { type: 'lesion_size', metadata: { lengthCm: 2.54, widthCm: 5.08, depthCm: null, bodyLocation: 'arm', side: 'left' } },
        IMPERIAL,
      ),
    ).toBe('1 × 2 in · arm (left)');
  });

  it('appends an optional note and truncates long note text', () => {
    expect(entrySummary({ type: 'heart_rate', metadata: { bpm: 90, note: 'after a nap' } })).toBe(
      'HR 90 bpm — after a nap',
    );
    const long = 'x'.repeat(80);
    expect(entrySummary({ type: 'note', metadata: { text: long } })).toBe('x'.repeat(60) + '…');
  });

  it('degrades gracefully on missing values instead of printing undefined', () => {
    expect(entrySummary({ type: 'temperature', metadata: {} })).toBe('Temp —');
    expect(entrySummary({ type: 'weight', metadata: {} })).toBe('Weight —');
    expect(entrySummary({ type: 'heart_rate' })).toBe('HR — bpm');
  });

  it('prefers the catalog display name once the entry is hydrated', () => {
    const entry = {
      type: 'lab_result',
      metadata: { analyte: 'FERRITIN', valueText: '37', unit: 'ng/mL', flag: 'L' },
      labContext: { displayName: 'Ferritin', referenceRange: null, goal: null },
    };
    expect(entrySummary(entry)).toBe('Ferritin 37 ng/mL (L)');
  });

  it('shows a lab result as reported — no unit conversion, flag only as printed', () => {
    expect(
      entrySummary({ type: 'lab_result', metadata: { analyte: 'FERRITIN', valueText: '37', unit: 'ng/mL', flag: 'L' } }),
    ).toBe('FERRITIN 37 ng/mL (L)');
    // Non-numeric printed values stay verbatim; no flag, no parentheses.
    expect(
      entrySummary({ type: 'lab_result', metadata: { analyte: 'TSH', valueText: '<0.2', unit: 'mIU/L', flag: null } }),
    ).toBe('TSH <0.2 mIU/L');
  });

  it('shows a document as a labeled attachment line', () => {
    expect(entrySummary({ type: 'document', metadata: { fileId: 'f1', label: 'Quest labs Jul 2026' } })).toBe(
      'document · Quest labs Jul 2026',
    );
    expect(entrySummary({ type: 'document', metadata: { fileId: 'f1' } })).toBe('document');
  });
});

describe('labSummary', () => {
  it('aggregates counts from printed flags only', () => {
    const labs = [
      { metadata: { flag: 'L' } },
      { metadata: { flag: null } },
      { metadata: { flag: 'H' } },
      { metadata: { flag: 'H' } },
      { metadata: {} },
    ];
    expect(labSummary(labs)).toBe('Labs: 5 results, 1 low, 2 high');
    expect(labSummary([{ metadata: {} }])).toBe('Labs: 1 result');
  });
});

describe('describeEvent', () => {
  const obsEvent = (entries: any[], text?: string): TimelineEntry =>
    ({ id: 'o1', kind: 'observation', type: 'temperature', timestamp: 1700000000, display: { text, entries } } as any);

  it('joins an observation note and its entries, in preferred units', () => {
    const e = obsEvent(
      [
        { type: 'temperature', metadata: { value: 38.4, unit: 'C', method: 'oral' } },
        { type: 'heart_rate', metadata: { bpm: 120 } },
      ],
      'seemed hot',
    );
    expect(describeEvent(e, IMPERIAL)).toBe('seemed hot — Temp 101.1 °F (oral) — HR 120 bpm');
  });

  it('leaves photo entries out of the text (they render as thumbnails)', () => {
    const e = obsEvent([
      { type: 'photo', metadata: { fileId: 'f1', bodyLocation: 'back', side: 'n/a' } },
      { type: 'heart_rate', metadata: { bpm: 100 } },
    ]);
    expect(describeEvent(e)).toBe('HR 100 bpm');
  });

  it('names the medication on a dose when the caller supplies the catalog', () => {
    const doseEvent = {
      id: 'i1',
      kind: 'intervention',
      type: 'medication_dose',
      timestamp: 1700000000,
      display: { type: 'medication_dose', metadata: { medicationId: 'm1', amountMg: 240 } },
    } as any;
    // The journal feed's line (frontend.md → Journal): "Dana — 240 mg ibuprofen · 2:15 AM".
    expect(describeEvent(doseEvent, CANONICAL_UNITS, { medicationNames: new Map([['m1', 'ibuprofen']]) })).toBe(
      '240 mg ibuprofen',
    );
    // Without the catalog it stays generic — the raw id is not something to show a caregiver.
    expect(describeEvent(doseEvent)).toBe('medication dose — 240 mg');
  });

  it('omits document entries only when the caller renders them as links', () => {
    const e = obsEvent([
      { type: 'document', metadata: { fileId: 'f1', label: 'Discharge summary' } },
      { type: 'heart_rate', metadata: { bpm: 100 } },
    ]);
    expect(describeEvent(e, CANONICAL_UNITS, { omitDocuments: true })).toBe('HR 100 bpm');
    // A caller with no link affordance keeps the text and stays whole.
    expect(describeEvent(e)).toBe('document · Discharge summary — HR 100 bpm');
  });

  it('aggregates lab_result entries into one line instead of one per analyte', () => {
    const labs = Array.from({ length: 30 }, (_, i) => ({
      type: 'lab_result',
      metadata: { analyte: `ANALYTE ${i}`, valueText: '1', flag: i === 0 ? 'L' : null },
    }));
    const e = obsEvent([...labs, { type: 'document', metadata: { fileId: 'f1', label: 'Quest labs' } }], 'Quest labs');
    expect(describeEvent(e)).toBe('Quest labs — Labs: 30 results, 1 low — document · Quest labs');
  });

  it('describes interventions', () => {
    const dose = {
      kind: 'intervention',
      display: { type: 'medication_dose', metadata: { amountMg: 160, isAtypical: true } },
    } as any;
    expect(describeEvent(dose)).toBe('medication dose — 160 mg (atypical)');

    const dressing = { kind: 'intervention', display: { type: 'dressing_change', metadata: { bodyLocation: 'arm' } } } as any;
    expect(describeEvent(dressing)).toBe('dressing change — arm');
  });

  it('falls back to the advisory type for advisory events', () => {
    expect(describeEvent({ kind: 'advisory', display: { type: 'stale_weight' } } as any)).toBe('stale_weight');
  });
});

describe('photoFileIds', () => {
  it('returns file ids for photo entries only', () => {
    const e = {
      kind: 'observation',
      display: {
        entries: [
          { type: 'photo', metadata: { fileId: 'f1' } },
          { type: 'photo', metadata: {} },
          { type: 'heart_rate', metadata: { bpm: 90 } },
        ],
      },
    } as any;
    expect(photoFileIds(e)).toEqual(['f1']);
  });

  it('returns nothing for non-observation events', () => {
    expect(photoFileIds({ kind: 'intervention', display: {} } as any)).toEqual([]);
  });
});
