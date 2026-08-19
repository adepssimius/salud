import { bandedDomain, describeBand, plotBands, toDisplayBands } from './value-bands';

describe('value-bands', () => {
  const reference = {
    id: 'r1',
    kind: 'reference' as const,
    label: 'Normal',
    low: 36.1,
    high: 37.2,
    refText: null,
    effectiveFrom: 0,
  };

  describe('toDisplayBands', () => {
    it('converts canonical °C bounds to the viewer unit', () => {
      const [band] = toDisplayBands([reference], 'F');
      expect(band.low).toBeCloseTo(97, 0);
      expect(band.high).toBeCloseTo(99, 0);
      expect(band.reference).toBe(true);
    });

    it('leaves °C alone and keeps a custom band marked as custom', () => {
      const [band] = toDisplayBands([{ ...reference, kind: 'custom', label: 'Call the clinic' }], 'C');
      expect(band).toMatchObject({ low: 36.1, high: 37.2, reference: false });
    });

    it('drops a text-only range — there is nothing to draw on an axis', () => {
      expect(
        toDisplayBands([{ ...reference, low: null, high: null, refText: 'varies with time of day' }], 'C'),
      ).toEqual([]);
    });

    it('keeps a one-sided range, which is normal rather than degenerate', () => {
      const [band] = toDisplayBands([{ ...reference, low: 38, high: null }], 'C');
      expect(band).toMatchObject({ low: 38, high: null });
    });
  });

  describe('bandedDomain', () => {
    it('covers the bands as well as the readings, so a band is never clipped off the chart', () => {
      // Every reading is well above the band; scaled to the readings alone the band would vanish.
      const domain = bandedDomain([39.0, 39.4], toDisplayBands([reference], 'C'), 1.5)!;
      expect(domain.lo).toBeLessThanOrEqual(36.1);
      expect(domain.hi).toBeGreaterThanOrEqual(39.4);
    });

    it('widens a flat run to the minimum span rather than drawing it as a dramatic swing', () => {
      const domain = bandedDomain([38.5, 38.7], [], 1.5)!;
      expect(domain.hi - domain.lo).toBeCloseTo(1.5, 5);
    });

    it('does not shrink a range already wider than the minimum span', () => {
      const domain = bandedDomain([36.0, 40.0], [], 1.5)!;
      expect(domain.lo).toBe(36.0);
      expect(domain.hi).toBe(40.0);
    });

    it('returns null when there is nothing at all to plot', () => {
      expect(bandedDomain([], [], 1.5)).toBeNull();
    });

    it('still yields a domain from bands alone', () => {
      const domain = bandedDomain([], toDisplayBands([reference], 'C'), 1.5)!;
      expect(domain).not.toBeNull();
      expect(domain.hi).toBeGreaterThan(domain.lo);
    });
  });

  describe('plotBands', () => {
    // A plain inverted axis: value 36 at the bottom (y=100), value 40 at the top (y=0).
    const yFor = (v: number) => 100 - ((v - 36) / 4) * 100;

    it('places a two-sided band between its bounds', () => {
      const [band] = plotBands(toDisplayBands([reference], 'C'), { lo: 36, hi: 40 }, yFor);
      expect(band.y).toBeCloseTo(yFor(37.2), 5);
      expect(band.height).toBeCloseTo(yFor(36.1) - yFor(37.2), 5);
    });

    it('fills an open-ended band to the edge of the chart in that direction', () => {
      const bands = toDisplayBands([{ ...reference, low: 38, high: null, label: 'Fever' }], 'C');
      const [band] = plotBands(bands, { lo: 36, hi: 40 }, yFor);
      // No high bound, so it runs to the top of the domain.
      expect(band.y).toBeCloseTo(yFor(40), 5);
      expect(band.height).toBeCloseTo(yFor(38) - yFor(40), 5);
    });

    it('never collapses to zero height, so a band always remains visible', () => {
      const bands = toDisplayBands([{ ...reference, low: 37.2, high: 37.2 }], 'C');
      const [band] = plotBands(bands, { lo: 36, hi: 40 }, yFor);
      expect(band.height).toBeGreaterThan(0);
    });
  });

  describe('describeBand', () => {
    it('reads a two-sided band as a span', () => {
      expect(describeBand({ label: 'Normal', low: 36.1, high: 37.2, reference: true }, ' °C')).toBe(
        'Normal 36.1–37.2 °C',
      );
    });

    it('reads one-sided bands in words', () => {
      expect(describeBand({ label: 'Fever', low: 38, high: null, reference: false }, ' °C')).toBe(
        'Fever at or above 38 °C',
      );
      expect(describeBand({ label: 'Low', low: null, high: 35, reference: false }, ' °C')).toBe(
        'Low at or below 35 °C',
      );
    });

    it('falls back to the bare label when there is nothing to state', () => {
      expect(describeBand({ label: 'Normal', low: null, high: null, reference: true }, ' °C')).toBe('Normal');
    });
  });
});
