import { ResolvedRange } from '@salud/shared/types';
import { convertTemp } from './event-display';

/**
 * Turning a patient's recorded ranges into something a chart can draw, shared by every surface that
 * plots a measured value against its standards.
 *
 * The rule that matters most here is in `bandedDomain`: **the bands are part of the y-domain**. A
 * chart auto-scaled to its readings alone silently clips the very reference the reader is checking
 * against — a night that never crossed the normal band would draw the band off-screen, which is the
 * one thing the picture exists to show. The analyte history chart established this
 * ("the standards set the scale too"); Home's sparkline and the journal chart follow it.
 *
 * Nothing here invents a range. A patient with no recorded bands gets `[]` and a scale-only chart:
 * the app renders what the household recorded and never substitutes its own idea of normal while
 * drawing (P6).
 */

/** A range with its bounds already converted to the unit the chart is drawn in. */
export interface DisplayBand {
  label: string;
  /** Null means open-ended in that direction — "at or above 38" has no high. */
  low: number | null;
  high: number | null;
  /** The `reference` lineage reads as the ground the others sit on. */
  reference: boolean;
}

/** A band positioned in chart space. `y` is the top edge, SVG-style. */
export interface PlottedBand extends DisplayBand {
  y: number;
  height: number;
  /**
   * The y of each **finite** bound, or null where the band is open-ended.
   *
   * Drawn as a thin edge line, because the bound is what a reader actually reads: "above this line"
   * is the question being asked of a fever chart, and a soft fill alone leaves the threshold itself
   * approximate. An open-ended side has no line — there is no bound there to draw.
   */
  lowY: number | null;
  highY: number | null;
}

export interface BandedDomain {
  lo: number;
  hi: number;
}

/**
 * Convert temperature bands from canonical °C to the viewer's unit.
 *
 * Bounds are stored canonically like every other measurement at the persistence boundary, so this
 * is the same conversion the points alongside them get — a band in °C drawn over readings in °F
 * would be a silent factual error rather than a visual one.
 */
export function toDisplayBands(ranges: ResolvedRange[], displayUnit: 'C' | 'F'): DisplayBand[] {
  return ranges
    // A text-only range ("varies with time of day") has nothing to draw; it still belongs in the
    // list on the analyte page, just not on an axis.
    .filter((r) => r.low !== null || r.high !== null)
    .map((r) => ({
      label: r.label,
      low: r.low === null ? null : convertTemp(r.low, 'C', displayUnit),
      high: r.high === null ? null : convertTemp(r.high, 'C', displayUnit),
      reference: r.kind === 'reference',
    }));
}

/**
 * The y-domain covering both the readings and every band bound, widened to `minSpan` so a flat
 * night doesn't draw like a dramatic one.
 *
 * Returns null when there is nothing to plot at all.
 */
export function bandedDomain(values: number[], bands: DisplayBand[], minSpan: number): BandedDomain | null {
  const all = [...values];
  for (const b of bands) {
    if (b.low !== null) all.push(b.low);
    if (b.high !== null) all.push(b.high);
  }
  if (!all.length) return null;

  let lo = Math.min(...all);
  let hi = Math.max(...all);
  // A floor on the span: without it a night that ran 38.5–38.7 draws the same swing as one that ran
  // 37.0–40.0, which is the chart editorializing about data it was only asked to plot (P6).
  const pad = Math.max(0, (minSpan - (hi - lo)) / 2);
  lo -= pad;
  hi += pad;
  return { lo, hi: hi === lo ? lo + minSpan : hi };
}

/**
 * Place bands in chart space. `yFor` maps a value to a y coordinate; `top`/`bottom` are the plot
 * area's edges, used to fill an open-ended band to the edge of the chart in that direction.
 */
export function plotBands(
  bands: DisplayBand[],
  domain: BandedDomain,
  yFor: (value: number) => number,
): PlottedBand[] {
  return bands.map((b) => {
    const y = yFor(b.high ?? domain.hi);
    const bottom = yFor(b.low ?? domain.lo);
    return {
      ...b,
      y,
      height: Math.max(bottom - y, 1),
      lowY: b.low === null ? null : yFor(b.low),
      highY: b.high === null ? null : yFor(b.high),
    };
  });
}

/**
 * How a band reads in words — the same phrasing the analyte page uses, so "at or above 38" means
 * the same thing on every surface.
 */
export function describeBand(b: DisplayBand, unitSuffix: string): string {
  if (b.low !== null && b.high !== null) return `${b.label} ${b.low}–${b.high}${unitSuffix}`;
  if (b.high !== null) return `${b.label} at or below ${b.high}${unitSuffix}`;
  if (b.low !== null) return `${b.label} at or above ${b.low}${unitSuffix}`;
  return b.label;
}
