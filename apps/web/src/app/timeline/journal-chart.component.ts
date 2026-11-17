import { Component, DestroyRef, ElementRef, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
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
  medicationName: string | null;
  /** The medication's catalog tags, resolved by the API at read time. */
  tags: string[];
  isAtypical: boolean;
}

interface EpisodeBand {
  id: string;
  name: string;
  startX: number;
  width: number;
}

interface DayTick {
  x: number;
  /** Position as a percentage of the chart width, for the HTML label row beneath the SVG. */
  pct: number;
  label: string;
  /** False when the label would collide with "now" at the right edge; the rule still draws. */
  showLabel: boolean;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
/** The fixed window the chart shows: a rolling 5 days ending now (frontend.md → Timeline). */
export const WINDOW_SECONDS = 5 * DAY;
/**
 * Consecutive readings further apart than this are not joined — unless both sit inside the same
 * episode's frame, where the curve is one story however sparse (frontend.md → Timeline).
 */
export const GAP_BREAK_SECONDS = 12 * HOUR;
/**
 * A midnight label closer than this to the right edge, in CSS pixels, would run into "now" (a
 * "Mon 16" label plus "now" at the axis font size, with a little air). Pixels, not a percentage: the
 * chart is a narrow column beside the feed on a desktop and nearly full width on a phone.
 */
const NOW_LABEL_CLEARANCE_PX = 70;
/** The width assumed before the chart has been measured (and in jsdom, which never lays out). */
const ASSUMED_WIDTH_PX = 360;
const CLOCK_TICK_MS = 60_000;

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
    <ng-container *ngIf="temperaturePoints().length || allDoseMarkersCount(); else empty">
    <svg [attr.viewBox]="'0 0 ' + chartWidth + ' ' + chartHeight" class="chart">
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

      <!-- Local midnights, so a reader can count days without reading every label. -->
      <line *ngFor="let t of dayTicks()" [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="0"
        [attr.y2]="chartHeight" class="day-rule" />

      <!-- Scale. A curve with no axis answers "how high is it" with a shape. -->
      <text [attr.x]="chartWidth - 4" [attr.y]="plotTop + 10" class="axis-label">{{ scaleHigh() }}°{{ tempUnit() }}</text>
      <text [attr.x]="chartWidth - 4" [attr.y]="plotBottom" class="axis-label">{{ scaleLow() }}°{{ tempUnit() }}</text>

      <!-- Temperature curve -->
      <!-- One polyline per run of joined readings: a long gap outside an episode breaks the line
           rather than drawing readings nobody took. -->
      <polyline *ngFor="let seg of temperatureSegments()" [attr.points]="seg" class="temp-line" />
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
          <title>{{ doseTitle(d) }}</title>
        </line>
      </g>
    </svg>
    <!-- HTML, not SVG text: the SVG scales down to roughly half size on a phone and its text with
         it, while these stay at the page's own small size. -->
    <div class="time-axis" aria-hidden="true">
      <ng-container *ngFor="let t of dayTicks()">
        <span *ngIf="t.showLabel" class="time-axis-label" [style.left.%]="t.pct">{{ t.label }}</span>
      </ng-container>
      <span class="time-axis-label time-axis-now">now</span>
    </div>
    <!-- Names which doses are drawn, in display terms. It says what is on the chart, never that
         the doses did anything to the readings (P6). Only beside a plot: with an empty window there
         is nothing for it to name. -->
    <p class="chart-legend small muted" *ngIf="overlayLegend()">
      <span class="legend-mark" aria-hidden="true"></span>
      Showing {{ overlayLegend() }} by default.
      <button type="button" class="link" *ngIf="dosesHiddenByDefault()" (click)="showAllDosesRequested.emit()">
        Show all doses
      </button>
    </p>
    </ng-container>
    <ng-template #empty>
      <p class="muted small">
        No temperature readings or doses in the last 5 days — earlier entries are in the journal below.
      </p>
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
      .chart-legend {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0.25rem 0 0;
      }
      /* Matches the marker's own stroke, so the legend reads as the thing on the chart. */
      .legend-mark {
        display: inline-block;
        width: 2px;
        height: 12px;
        background: #fbbf24;
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
      .day-rule {
        stroke: rgba(148, 163, 184, 0.15);
        stroke-width: 1;
      }
      .time-axis {
        position: relative;
        height: 1.1rem;
        margin-top: 0.15rem;
      }
      .time-axis-label {
        position: absolute;
        top: 0;
        font-size: 0.75rem;
        color: var(--text-muted);
        white-space: nowrap;
        padding-left: 3px;
      }
      .time-axis-now {
        right: 0;
        padding-left: 0;
      }
      .dose-marker.atypical {
        stroke: #f87171;
      }
    `,
  ],
})
export class JournalChartComponent {
  private readonly auth = inject(AuthService);

  /**
   * The window's right edge, epoch seconds. Advances once a minute, so a journal left open overnight
   * doesn't freeze its "now". Public so a spec can pin it.
   */
  readonly now = signal(Math.floor(Date.now() / 1000));
  readonly windowStart = computed(() => this.now() - WINDOW_SECONDS);

  /** The rendered width in CSS pixels, for deciding which axis labels fit. */
  private readonly widthPx = signal(ASSUMED_WIDTH_PX);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const timer = setInterval(() => this.now.set(Math.floor(Date.now() / 1000)), CLOCK_TICK_MS);
    destroyRef.onDestroy(() => clearInterval(timer));
    if (typeof ResizeObserver !== 'undefined') {
      const host = inject(ElementRef).nativeElement as HTMLElement;
      const observer = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width > 0) this.widthPx.set(entry.contentRect.width);
      });
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    }
  }

  private inWindow(ts: number): boolean {
    return ts >= this.windowStart() && ts <= this.now();
  }

  chartWidth = CHART_WIDTH;
  chartHeight = CHART_HEIGHT;
  doseMarkerY = DOSE_MARKER_Y;
  plotTop = PLOT_TOP;
  plotBottom = PLOT_BOTTOM;

  private readonly entriesSignal = signal<TimelineEntry[]>([]);
  private readonly episodesSignal = signal<Episode[]>([]);
  private readonly rangesSignal = signal<ResolvedRange[]>([]);
  private readonly overlayTagsSignal = signal<string[]>([]);
  private readonly showAllDosesSignal = signal(false);
  private readonly medicationNamesSignal = signal<Map<string, string>>(new Map());

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

  /**
   * The medication tags whose doses this chart shows by default (api.md → "Chart overlay
   * defaults"). Empty disables the default selection entirely and every dose shows.
   */
  @Input() set overlayTags(value: string[]) {
    this.overlayTagsSignal.set(value ?? []);
  }

  /** The reader's explicit "show every dose" override of the default above. */
  @Input() set showAllDoses(value: boolean) {
    this.showAllDosesSignal.set(!!value);
  }

  /** Medication id → name, so a marker's tooltip can name what was given. */
  @Input() set medicationNames(value: Map<string, string>) {
    this.medicationNamesSignal.set(value ?? new Map());
  }

  /** Emits the episode id behind a clicked band; the page owns navigation. */
  @Output() episodeSelected = new EventEmitter<string>();

  /** The reader asking to widen past the default selection; the page owns the flag. */
  @Output() showAllDosesRequested = new EventEmitter<void>();

  /**
   * A marker's tooltip: what was given, how much, and when. Presence only — deliberately no
   * language about what the dose did, on the marker or beside it (P6).
   */
  doseTitle(dose: DoseMarker): string {
    const parts = [dose.medicationName, dose.amountMg != null ? `${dose.amountMg} mg` : null].filter(Boolean);
    const what = parts.length ? parts.join(' · ') : 'Dose';
    const when = new Date(dose.timestamp * 1000).toLocaleString();
    return `${what} at ${when}${dose.isAtypical ? ' (atypical)' : ''}`;
  }

  // Displayed in the caregiver's preferred unit (product.md:49: "graphs normalize to the preferred
  // unit"), converting from whatever unit each entry happened to be recorded in.
  tempUnit = computed(() => unitsFor(this.auth.user()).temp);

  temperaturePoints = computed<TempPoint[]>(() => {
    const displayUnit = this.tempUnit();
    const points: TempPoint[] = [];
    for (const entry of this.entriesSignal()) {
      if (entry.kind !== 'observation') continue;
      const obs = entry.display as any;
      // Outside the window means off both axes, not just off-screen (frontend.md → Timeline).
      if (!this.inWindow(obs.observedAt)) continue;
      for (const e of obs.entries ?? []) {
        if (e.type !== 'temperature' || !e.metadata) continue;
        const value = convertTemp(e.metadata.value, e.metadata.unit === 'F' ? 'F' : 'C', displayUnit);
        points.push({ timestamp: obs.observedAt, value });
      }
    }
    return points.sort((a, b) => a.timestamp - b.timestamp);
  });

  /**
   * Every dose in the window. What the chart *draws* is `doseMarkers` below, which may be a subset.
   */
  private readonly allDoseMarkers = computed<DoseMarker[]>(() =>
    this.entriesSignal()
      .filter((e) => e.kind === 'intervention' && e.type === 'medication_dose')
      .filter((e) => this.inWindow((e.display as any).performedAt))
      .map((e) => {
        const int = e.display as any;
        return {
          timestamp: int.performedAt,
          amountMg: int.metadata?.amountMg ?? null,
          medicationId: int.metadata?.medicationId ?? null,
          medicationName: this.medicationNamesSignal().get(int.metadata?.medicationId) ?? null,
          tags: Array.isArray(int.medicationTags) ? int.medicationTags : [],
          isAtypical: !!int.metadata?.isAtypical,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp),
  );

  /**
   * The markers actually drawn: by default, doses whose medication carries one of this metric's
   * configured overlay tags (data-model.md → ChartOverlayDefault).
   *
   * A **display default**, not a judgment — the app is saying "you probably want these visible
   * together", never that the doses did anything to the readings, and no annotation on or near a
   * marker ever says otherwise (P6). The reader overrides in both directions: `showAllDoses`
   * widens back to everything the payload carries, and the page's filter chips replace the
   * selection outright by clearing `overlayTags`.
   *
   * No configured tags means no default selection to apply, so everything shows — the same as
   * before this feature existed.
   */
  doseMarkers = computed<DoseMarker[]>(() => {
    const tags = this.overlayTagsSignal();
    const all = this.allDoseMarkers();
    if (!tags.length || this.showAllDosesSignal()) return all;
    const wanted = new Set(tags);
    return all.filter((d) => d.tags.some((tag) => wanted.has(tag)));
  });

  /** True when the default selection is hiding doses the payload carries — drives the legend. */
  dosesHiddenByDefault = computed(
    () => this.allDoseMarkers().length > this.doseMarkers().length,
  );

  /**
   * Every dose in range, drawn or not. The chart renders whenever the payload holds *something*,
   * so a default that happens to select nothing still shows the plot and its "Show all doses"
   * affordance rather than collapsing to the empty state.
   */
  allDoseMarkersCount = computed(() => this.allDoseMarkers().length);

  /** "antipyretic doses" / "antipyretic and analgesic doses" — names the default, nothing more. */
  overlayLegend = computed(() => {
    const tags = this.overlayTagsSignal();
    if (!tags.length || this.showAllDosesSignal()) return null;
    const names = tags.length === 1 ? tags[0] : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
    return `${names} doses`;
  });

  /**
   * Always the full window, however sparse the readings: the same width means the same span of time
   * every time the chart is opened.
   */
  timeRange = computed<{ min: number; max: number }>(() => ({ min: this.windowStart(), max: this.now() }));

  /** A rule and a "Thu 12" label at every local midnight inside the window. */
  dayTicks = computed<DayTick[]>(() => {
    const { min, max } = this.timeRange();
    const ticks: DayTick[] = [];
    // Walk back from today's midnight a local day at a time; stepping by an hour before midnight
    // rather than a flat 86400 keeps the two DST days a year on their real midnights.
    for (let d = startOfLocalDay(max); d > min; d = startOfLocalDay(d - HOUR)) {
      const pct = ((d - min) / (max - min)) * 100;
      ticks.unshift({
        x: this.xScale(d),
        pct,
        label: new Date(d * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
        showLabel: ((100 - pct) / 100) * this.widthPx() >= NOW_LABEL_CLEARANCE_PX,
      });
    }
    return ticks;
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

  /**
   * The curve as runs of joined readings, each a polyline `points` string. Only runs of two or more
   * readings draw a line; a lone reading is still drawn as its point.
   */
  temperatureSegments = computed<string[]>(() => {
    const runs: Array<Array<{ timestamp: number; x: number; y: number }>> = [];
    for (const p of this.temperaturePlotted()) {
      const run = runs[runs.length - 1];
      const prev = run?.[run.length - 1];
      if (prev && this.joined(prev.timestamp, p.timestamp)) run.push(p);
      else runs.push([p]);
    }
    return runs.filter((r) => r.length > 1).map((r) => r.map((p) => `${p.x},${p.y}`).join(' '));
  });

  /**
   * Whether two consecutive readings are connected: close enough in time, or both inside one
   * episode's frame — the same start/end span the bands and the feed's dividers use.
   */
  private joined(a: number, b: number): boolean {
    if (b - a <= GAP_BREAK_SECONDS) return true;
    return this.episodesSignal().some((ep) => {
      if (ep.startedAt == null || a < ep.startedAt) return false;
      return ep.endedAt == null || b <= ep.endedAt;
    });
  }

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

/** Midnight local time for an epoch-seconds instant. */
function startOfLocalDay(epochSeconds: number): number {
  const d = new Date(epochSeconds * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// One decimal — the precision a thermometer reports, and what the rest of the app shows.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
