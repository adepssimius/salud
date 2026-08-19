import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { convertTemp, unitsFor } from '../core/event-display';
import { Episode, ResolvedRange, TimelineEntry } from '@salud/shared/types';
import { DisplayBand, PlottedBand, bandedDomain, describeBand, plotBands, toDisplayBands } from '../core/value-bands';

interface TempPoint {
  timestamp: number;
  /** Already normalized to the viewer's preferred unit — product.md:49. */
  value: number;
}

interface DoseMarker {
  timestamp: number;
  amountMg: number | null;
  medicationId: string | null;
  isAtypical: boolean;
}

interface EpisodeBand {
  id: string;
  name: string;
  startX: number;
  width: number;
}

const CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 210;
const DOSE_MARKER_Y = 230;
// A floor on the y-domain, in °C, matching Home's sparkline: a flat stretch must not draw like a
// dramatic one just because it is the only thing on screen.
const MIN_SPAN_C = 1.5;

/**
 * The journal's instrument panel — the hand-drawn temperature curve with dose markers overlaid at
 * their `performedAt` positions and episode frames as shaded bands (frontend.md → Timeline, folded
 * into → Journal as the feed's collapsible header).
 *
 * Every rendering rule from the v1 Timeline page carries over verbatim, including the one that
 * matters most: **no computed "responsive to X" annotation ever renders on or near a dose marker**
 * (P6). The overlay is the raw series and nothing else; the reader draws the conclusion.
 *
 * Presentational by design. It takes the entries the page already fetched rather than fetching its
 * own, which is what lets one set of filter chips drive the chart and the feed together — two
 * requests would eventually disagree about what "ibuprofen only" means.
 */
@Component({
  selector: 'app-journal-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      *ngIf="temperaturePoints().length || doseMarkers().length; else empty"
      [attr.viewBox]="'0 0 ' + chartWidth + ' ' + chartHeight"
      class="chart"
    >
      <!-- Episode frames -->
      <g>
        <rect
          *ngFor="let band of episodeBands()"
          [attr.x]="band.startX"
          [attr.y]="0"
          [attr.width]="band.width"
          [attr.height]="chartHeight"
          class="episode-band"
          (click)="episodeSelected.emit(band.id)"
        >
          <title>{{ band.name }}</title>
        </rect>
      </g>

      <!-- The patient's own temperature bands, behind everything. What counts as normal is the
           household's recorded standard, never a number this chart supplies while drawing (P6). -->
      <g *ngFor="let band of plottedBands()">
        <rect [attr.x]="0" [attr.y]="band.y" [attr.width]="chartWidth" [attr.height]="band.height"
          [class.value-band]="band.reference" [class.value-band-custom]="!band.reference">
          <title>{{ bandTitle(band) }}</title>
        </rect>
        <!-- The bound is the thing read off the chart; the fill only says which side is which. -->
        <line *ngIf="band.highY !== null" [attr.x1]="0" [attr.x2]="chartWidth"
          [attr.y1]="band.highY" [attr.y2]="band.highY" class="band-edge" />
        <line *ngIf="band.lowY !== null" [attr.x1]="0" [attr.x2]="chartWidth"
          [attr.y1]="band.lowY" [attr.y2]="band.lowY" class="band-edge" />
        <text [attr.x]="6" [attr.y]="band.y + 12" class="band-label">{{ bandTitle(band) }}</text>
      </g>

      <!-- Scale. A curve with no axis answers "how high is it" with a shape. -->
      <text [attr.x]="chartWidth - 4" [attr.y]="plotTop + 10" class="axis-label">{{ scaleHigh() }}°{{ tempUnit() }}</text>
      <text [attr.x]="chartWidth - 4" [attr.y]="plotBottom" class="axis-label">{{ scaleLow() }}°{{ tempUnit() }}</text>

      <!-- Temperature curve -->
      <polyline *ngIf="temperaturePoints().length" [attr.points]="temperaturePolylinePoints()" class="temp-line" />
      <g *ngFor="let p of temperaturePlotted()">
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="temp-point">
          <title>{{ p.value | number: '1.1-1' }}°{{ tempUnit() }} at {{ p.timestamp * 1000 | date: 'short' }}</title>
        </circle>
      </g>

      <!-- Dose markers. Raw positions only — never an annotation about what a dose did (P6). -->
      <g *ngFor="let d of dosePlotted()">
        <line
          [attr.x1]="d.x"
          [attr.y1]="doseMarkerY - 8"
          [attr.x2]="d.x"
          [attr.y2]="doseMarkerY + 8"
          [class.atypical]="d.isAtypical"
          class="dose-marker"
        >
          <title>{{ d.amountMg }} mg at {{ d.timestamp * 1000 | date: 'short' }}{{ d.isAtypical ? ' (atypical)' : '' }}</title>
        </line>
      </g>
    </svg>
    <ng-template #empty>
      <p class="muted small">No temperature readings or doses in range yet.</p>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .muted {
        margin: 0;
      }
      .chart {
        width: 100%;
        height: auto;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .episode-band {
        fill: rgba(148, 163, 184, 0.08);
        cursor: pointer;
      }
      .episode-band:hover {
        fill: rgba(148, 163, 184, 0.18);
      }
      .temp-line {
        fill: none;
        stroke: var(--accent-bright);
        stroke-width: 2;
      }
      .temp-point {
        fill: var(--accent-bright);
      }
      .dose-marker {
        stroke: #fbbf24;
        stroke-width: 2;
      }
      /* Same relationship as .range-band on the analyte history chart: the recorded standard is the
         ground the series sits on, and a custom band sits lighter than the reference one. */
      .value-band {
        fill: rgba(148, 163, 184, 0.13);
      }
      .value-band-custom {
        fill: rgba(148, 163, 184, 0.06);
      }
      .band-edge {
        stroke: rgba(148, 163, 184, 0.4);
        stroke-width: 1;
        stroke-dasharray: 4 4;
      }
      .band-label {
        fill: var(--text-muted);
        font-size: 10px;
      }
      .axis-label {
        fill: var(--text-muted);
        font-size: 11px;
        text-anchor: end;
      }
      .dose-marker.atypical {
        stroke: #f87171;
      }
    `,
  ],
})
export class JournalChartComponent {
  private readonly auth = inject(AuthService);

  chartWidth = CHART_WIDTH;
  chartHeight = CHART_HEIGHT;
  doseMarkerY = DOSE_MARKER_Y;
  plotTop = PLOT_TOP;
  plotBottom = PLOT_BOTTOM;

  private readonly entriesSignal = signal<TimelineEntry[]>([]);
  private readonly episodesSignal = signal<Episode[]>([]);
  private readonly rangesSignal = signal<ResolvedRange[]>([]);

  @Input({ required: true }) set entries(value: TimelineEntry[]) {
    this.entriesSignal.set(value ?? []);
  }

  @Input() set episodes(value: Episode[]) {
    this.episodesSignal.set(value ?? []);
  }

  /**
   * The patient's temperature bands (canonical °C), as resolved `AnalyteRange` rows. Presentational
   * like everything else here — the page fetches them, the chart draws them.
   */
  @Input() set temperatureRanges(value: ResolvedRange[]) {
    this.rangesSignal.set(value ?? []);
  }

  /** Emits the episode id behind a clicked band; the page owns navigation. */
  @Output() episodeSelected = new EventEmitter<string>();

  // Displayed in the caregiver's preferred unit (product.md:49: "graphs normalize to the preferred
  // unit"), converting from whatever unit each entry happened to be recorded in.
  tempUnit = computed(() => unitsFor(this.auth.user()).temp);

  temperaturePoints = computed<TempPoint[]>(() => {
    const displayUnit = this.tempUnit();
    const points: TempPoint[] = [];
    for (const entry of this.entriesSignal()) {
      if (entry.kind !== 'observation') continue;
      const obs = entry.display as any;
      for (const e of obs.entries ?? []) {
        if (e.type !== 'temperature' || !e.metadata) continue;
        const value = convertTemp(e.metadata.value, e.metadata.unit === 'F' ? 'F' : 'C', displayUnit);
        points.push({ timestamp: obs.observedAt, value });
      }
    }
    return points.sort((a, b) => a.timestamp - b.timestamp);
  });

  doseMarkers = computed<DoseMarker[]>(() =>
    this.entriesSignal()
      .filter((e) => e.kind === 'intervention' && e.type === 'medication_dose')
      .map((e) => {
        const int = e.display as any;
        return {
          timestamp: int.performedAt,
          amountMg: int.metadata?.amountMg ?? null,
          medicationId: int.metadata?.medicationId ?? null,
          isAtypical: !!int.metadata?.isAtypical,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp),
  );

  private timeRange = computed<{ min: number; max: number }>(() => {
    const timestamps = [
      ...this.temperaturePoints().map((p) => p.timestamp),
      ...this.doseMarkers().map((d) => d.timestamp),
    ];
    if (!timestamps.length) {
      const now = Math.floor(Date.now() / 1000);
      return { min: now - 7 * 86400, max: now };
    }
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    return min === max ? { min: min - 3600, max: max + 3600 } : { min, max };
  });

  private xScale(ts: number): number {
    const { min, max } = this.timeRange();
    return ((ts - min) / (max - min)) * this.chartWidth;
  }

  /** The patient's bands, converted to the unit this chart is drawn in. */
  bands = computed<DisplayBand[]>(() => toDisplayBands(this.rangesSignal(), this.tempUnit()));

  /**
   * The y-domain covers the readings **and every band bound**, the same rule the analyte history
   * chart follows ("the standards set the scale too") and Home's sparkline now shares. A band the
   * readings never reach is exactly the reference the reader is checking against; scaling it off
   * the chart would hide the one thing the picture is for.
   */
  private valueRange = computed<{ min: number; max: number }>(() => {
    const values = this.temperaturePoints().map((p) => p.value);
    const minSpan = this.tempUnit() === 'F' ? (MIN_SPAN_C * 9) / 5 : MIN_SPAN_C;
    const domain = bandedDomain(values, this.bands(), minSpan);
    if (!domain) return { min: 35, max: 40 };
    return { min: domain.lo, max: domain.hi };
  });

  private yScale(value: number): number {
    const { min, max } = this.valueRange();
    const usable = PLOT_BOTTOM - PLOT_TOP;
    return PLOT_BOTTOM - ((value - min) / (max - min)) * usable;
  }

  /** Bands in chart space, drawn behind the curve and spanning the full width. */
  plottedBands = computed<PlottedBand[]>(() => {
    const { min, max } = this.valueRange();
    return plotBands(this.bands(), { lo: min, hi: max }, (v) => this.yScale(v));
  });

  /** The y-domain's edges, so the curve's amplitude is readable as a number. */
  scaleHigh = computed(() => round1(this.valueRange().max));
  scaleLow = computed(() => round1(this.valueRange().min));

  bandTitle(band: DisplayBand): string {
    return describeBand(band, ` °${this.tempUnit()}`);
  }

  temperaturePlotted = computed(() =>
    this.temperaturePoints().map((p) => ({ ...p, x: this.xScale(p.timestamp), y: this.yScale(p.value) })),
  );

  temperaturePolylinePoints = computed(() =>
    this.temperaturePlotted()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  dosePlotted = computed(() => this.doseMarkers().map((d) => ({ ...d, x: this.xScale(d.timestamp) })));

  episodeBands = computed<EpisodeBand[]>(() => {
    const { min, max } = this.timeRange();
    return this.episodesSignal()
      .map((ep: any) => {
        const start = ep.startedAt ?? min;
        const end = ep.endedAt ?? max;
        const clampedStart = Math.max(start, min);
        const clampedEnd = Math.min(end, max);
        if (clampedEnd <= clampedStart) return null;
        const startX = this.xScale(clampedStart);
        const width = this.xScale(clampedEnd) - startX;
        return { id: ep.id, name: ep.name, startX, width };
      })
      .filter((b): b is EpisodeBand => b !== null);
  });
}

// One decimal — the precision a thermometer reports, and what the rest of the app shows.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
