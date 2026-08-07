import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { convertTemp, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { Episode, Medication, TimelineResponse } from '@salud/shared/types';

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

@Component({
  selector: 'app-timeline-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="backToPatient()">&larr; Patient</button>
      <h1>Timeline</h1>
      <p class="muted" *ngIf="timeline() as t">
        {{ t.patient.fullName }}
        <span *ngIf="t.weightPrompt.needsUpdate" class="weight-warn">
          · weight {{ t.weightPrompt.daysSince === null ? 'never recorded' : t.weightPrompt.daysSince + ' days old' }}
        </span>
      </p>

      <div class="filters">
        <span class="filter-label">Medication:</span>
        <button
          type="button"
          class="chip"
          [class.active]="!selectedMedicationId()"
          (click)="clearMedicationFilter()"
        >
          All
        </button>
        <button
          type="button"
          class="chip"
          *ngFor="let m of medications()"
          [class.active]="selectedMedicationId() === m.id"
          (click)="filterByMedication(m.id)"
        >
          {{ m.name }}
        </button>
      </div>
      <div class="filters" *ngIf="allTags().length">
        <span class="filter-label">Tag:</span>
        <button
          type="button"
          class="chip"
          *ngFor="let tag of allTags()"
          [class.active]="selectedTag() === tag"
          (click)="filterByTag(tag)"
        >
          {{ tag }}
        </button>
      </div>

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
          >
            <title>{{ band.name }}</title>
          </rect>
        </g>

        <!-- Temperature curve -->
        <polyline *ngIf="temperaturePoints().length" [attr.points]="temperaturePolylinePoints()" class="temp-line" />
        <g *ngFor="let p of temperaturePlotted()">
          <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="temp-point">
            <title>{{ p.value | number: '1.1-1' }}°{{ tempUnit() }} at {{ p.timestamp * 1000 | date: 'short' }}</title>
          </circle>
        </g>

        <!-- Dose markers -->
        <g *ngFor="let d of dosePlotted()">
          <line [attr.x1]="d.x" [attr.y1]="doseMarkerY - 8" [attr.x2]="d.x" [attr.y2]="doseMarkerY + 8" [class.atypical]="d.isAtypical" class="dose-marker">
            <title>{{ d.amountMg }} mg at {{ d.timestamp * 1000 | date: 'short' }}{{ d.isAtypical ? ' (atypical)' : '' }}</title>
          </line>
        </g>
      </svg>
      <ng-template #empty>
        <p class="muted">No temperature readings or doses in range yet.</p>
      </ng-template>

      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .muted {
        color: #cbd5e1;
        margin: 0;
      }
      .weight-warn {
        color: #fcd34d;
      }
      .link {
        align-self: flex-start;
        background: none;
        border: none;
        color: #7dd3fc;
        cursor: pointer;
        padding: 0;
      }
      .filters {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
      }
      .filter-label {
        color: #cbd5e1;
        font-size: 0.85rem;
      }
      .chip {
        padding: 0.25rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: transparent;
        color: #e2e8f0;
        font-size: 0.8rem;
        cursor: pointer;
      }
      .chip.active {
        background: rgba(34, 211, 238, 0.15);
        border-color: rgba(34, 211, 238, 0.4);
        color: #7dd3fc;
      }
      .chart {
        width: 100%;
        height: auto;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
      }
      .episode-band {
        fill: rgba(148, 163, 184, 0.08);
      }
      .temp-line {
        fill: none;
        stroke: #22d3ee;
        stroke-width: 2;
      }
      .temp-point {
        fill: #22d3ee;
      }
      .dose-marker {
        stroke: #fbbf24;
        stroke-width: 2;
      }
      .dose-marker.atypical {
        stroke: #f87171;
      }
      .error {
        color: #fca5a5;
      }
    `,
  ],
})
export class TimelinePage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = this.route.snapshot.paramMap.get('id')!;
  chartWidth = CHART_WIDTH;
  chartHeight = CHART_HEIGHT;
  doseMarkerY = DOSE_MARKER_Y;

  timeline = signal<TimelineResponse | null>(null);
  episodes = signal<Episode[]>([]);
  medications = signal<Medication[]>([]);
  selectedMedicationId = signal<string | null>(null);
  selectedTag = signal<string | null>(null);
  error = signal<string | null>(null);

  // Displayed in the caregiver's preferred unit (product.md:49: "graphs normalize to the preferred
  // unit"), converting from whatever unit each entry happened to be recorded in.
  tempUnit = computed(() => unitsFor(this.auth.user()).temp);

  temperaturePoints = computed<TempPoint[]>(() => {
    const t = this.timeline();
    if (!t) return [];
    const displayUnit = this.tempUnit();
    const points: TempPoint[] = [];
    for (const entry of t.entries) {
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

  doseMarkers = computed<DoseMarker[]>(() => {
    const t = this.timeline();
    if (!t) return [];
    return t.entries
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
      .sort((a, b) => a.timestamp - b.timestamp);
  });

  allTags = computed<string[]>(() => {
    const tags = new Set<string>();
    for (const m of this.medications()) {
      for (const t of m.tags) tags.add(t);
    }
    return Array.from(tags).sort();
  });

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

  private valueRange = computed<{ min: number; max: number }>(() => {
    const values = this.temperaturePoints().map((p) => p.value);
    if (!values.length) return { min: 35, max: 40 };
    const min = Math.min(...values) - 0.5;
    const max = Math.max(...values) + 0.5;
    return min === max ? { min: min - 1, max: max + 1 } : { min, max };
  });

  private yScale(value: number): number {
    const { min, max } = this.valueRange();
    const usable = PLOT_BOTTOM - PLOT_TOP;
    return PLOT_BOTTOM - ((value - min) / (max - min)) * usable;
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
    return this.episodes()
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

  ngOnInit(): void {
    this.loadMedications();
    this.loadEpisodes();
    this.load();
  }

  private loadMedications() {
    this.api.get<Medication[]>('/medications').subscribe({
      next: (res) => this.medications.set(res),
      error: () => this.medications.set([]),
    });
  }

  private loadEpisodes() {
    this.api.get<Episode[]>(`/patients/${this.patientId}/episodes`).subscribe({
      next: (res) => this.episodes.set(res),
      error: () => this.episodes.set([]),
    });
  }

  private load() {
    const params: Record<string, string> = {};
    if (this.selectedMedicationId()) params['medicationId'] = this.selectedMedicationId()!;
    if (this.selectedTag()) params['medicationTag'] = this.selectedTag()!;
    this.api.get<TimelineResponse>(`/patients/${this.patientId}/timeline`, params).subscribe({
      next: (res) => this.timeline.set(res),
      error: (err) => this.error.set(errorText(err, 'Unable to load timeline.')),
    });
  }

  filterByMedication(medicationId: string) {
    this.selectedMedicationId.set(medicationId);
    this.selectedTag.set(null);
    this.load();
  }

  filterByTag(tag: string) {
    this.selectedTag.set(tag);
    this.selectedMedicationId.set(null);
    this.load();
  }

  clearMedicationFilter() {
    this.selectedMedicationId.set(null);
    this.selectedTag.set(null);
    this.load();
  }

  backToPatient() {
    this.router.navigate(['/patients', this.patientId]);
  }
}
