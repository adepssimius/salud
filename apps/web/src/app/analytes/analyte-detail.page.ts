import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Analyte, AnalyteHistory, AnalyteRange, Patient } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';

interface PlottedPoint {
  x: number;
  y: number;
  valueText: string;
  unit: string | null;
  observedAt: number;
}

/** One effective-dated row drawn as a band: horizontal extent is its era, vertical is its bounds. */
interface RangeBand {
  x: number;
  width: number;
  y: number;
  height: number;
  label: string;
  reference: boolean;
  labelX: number;
  labelY: number;
}

/** A named band's history — successive versions of one standard, newest first. */
interface Lineage {
  key: string;
  label: string;
  kind: AnalyteRange['kind'];
  rows: AnalyteRange[];
  currentId: string | null;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD = 8;

@Component({
  selector: 'app-analyte-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="card" *ngIf="analyte() as a; else loadingOrError">
      <div class="card-header">
        <div>
          <h1>{{ a.displayName }}</h1>
          <p class="muted small" *ngIf="a.panel">Reported under {{ a.panel }}</p>
          <p class="muted small">
            As the lab prints it: <strong>{{ a.name }}</strong> — incoming reports match on this.
          </p>
        </div>
        <button type="button" class="secondary" (click)="back()">Back to catalog</button>
      </div>

      <form [formGroup]="headerForm" (ngSubmit)="saveHeader()" class="header-form">
        <label class="field">
          <span>Display name</span>
          <input type="text" formControlName="displayName" />
        </label>
        <label class="field">
          <span>Unit</span>
          <input type="text" formControlName="unit" placeholder="ng/mL" />
        </label>
        <label class="field">
          <span>Panel</span>
          <input type="text" formControlName="panel" placeholder="the panel it is reported under" />
        </label>
        <button type="submit" class="primary" [disabled]="headerForm.invalid || savingHeader()">
          {{ savingHeader() ? 'Saving…' : 'Save' }}
        </button>
      </form>
      <div class="error" *ngIf="headerError()">{{ headerError() }}</div>

      <section>
        <h2>Ranges and history</h2>
        <p class="muted small">
          Ranges belong to a patient: what a value should be depends on who was measured.
        </p>
        <label class="field">
          <span>Patient</span>
          <select [ngModel]="patientId()" (ngModelChange)="selectPatient($event)" [ngModelOptions]="{ standalone: true }">
            <option [ngValue]="null">—</option>
            <option *ngFor="let p of patients()" [ngValue]="p.id">{{ p.fullName }}</option>
          </select>
        </label>
        <div class="error" *ngIf="patientsError()">{{ patientsError() }}</div>

        <ng-container *ngIf="patientId()">
          <div class="error" *ngIf="rangesError()">{{ rangesError() }}</div>

          <div class="lineage" *ngFor="let lin of lineages()">
            <h3>
              {{ lin.label }}
              <span class="pill pill-neutral" *ngIf="lin.kind === 'reference'">from the lab</span>
            </h3>
            <ul class="row-list">
              <li *ngFor="let r of lin.rows">
                <div>
                  <strong>{{ describeRange(r) }}</strong>
                  <span class="pill pill-success" *ngIf="r.id === lin.currentId">current</span>
                  <div class="muted small">
                    from {{ r.effectiveFrom * 1000 | date: 'mediumDate' }}<span *ngIf="r.source"> · {{ r.source }}</span>
                  </div>
                </div>
                <button type="button" class="secondary" (click)="deleteRange(r.id)">Remove</button>
              </li>
            </ul>
          </div>
          <p class="muted" *ngIf="!lineages().length">No ranges recorded for this patient yet.</p>

          <button type="button" class="secondary" (click)="toggleRangeForm()">
            {{ showRangeForm() ? 'Cancel' : '+ Add range' }}
          </button>
          <form *ngIf="showRangeForm()" [formGroup]="rangeForm" (ngSubmit)="addRange()" class="stacked">
            <label class="field">
              <span>Name</span>
              <input type="text" formControlName="label" placeholder="Reference, Optimal, Athletic goal, …" />
            </label>
            <div class="row">
              <label class="field grow">
                <span>Low</span>
                <input type="number" step="any" formControlName="low" />
              </label>
              <label class="field grow">
                <span>High</span>
                <input type="number" step="any" formControlName="high" />
              </label>
            </div>
            <p class="muted small">One bound is enough — leave the other blank for "at or above 120".</p>
            <label class="field">
              <span>Range text (when it isn't a simple low–high)</span>
              <input type="text" formControlName="refText" placeholder="&lt;90" />
            </label>
            <label class="field">
              <span>In effect from</span>
              <input type="date" formControlName="effectiveFrom" />
            </label>
            <label class="field">
              <span>Source</span>
              <input type="text" formControlName="source" placeholder="Quest report, lab handout, …" />
            </label>
            <label class="inline-check">
              <input type="checkbox" formControlName="isReference" />
              <span>This is the lab's own reference range — compare imported reports against it</span>
            </label>
            <button type="submit" class="primary" [disabled]="rangeForm.invalid || savingRange()">
              {{ savingRange() ? 'Saving…' : 'Add range' }}
            </button>
          </form>
          <p class="muted small">
            Interpretation bands like "Deficiency below 20" are entered here by hand — the app never
            reads them out of a report's advice text.
          </p>

          <div class="error" *ngIf="historyError()">{{ historyError() }}</div>
          <p class="muted small" *ngIf="mixedUnits()">
            These results were not all reported in the same unit, so they are listed rather than
            charted together.
          </p>
          <svg
            *ngIf="plotted().length > 1 && !mixedUnits()"
            [attr.viewBox]="'0 0 ' + chartWidth + ' ' + chartHeight"
            class="chart"
          >
            <g *ngFor="let band of rangeBands()">
              <rect
                [attr.x]="band.x"
                [attr.y]="band.y"
                [attr.width]="band.width"
                [attr.height]="band.height"
                [class.range-band]="band.reference"
                [class.custom-band]="!band.reference"
              >
                <title>{{ band.label }}</title>
              </rect>
              <text [attr.x]="band.labelX" [attr.y]="band.labelY" class="band-label">{{ band.label }}</text>
            </g>
            <polyline [attr.points]="polylinePoints()" class="value-line" />
            <g *ngFor="let p of plotted()">
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3.5" class="value-point">
                <title>{{ p.valueText }}{{ p.unit ? ' ' + p.unit : '' }} on {{ p.observedAt * 1000 | date: 'mediumDate' }}</title>
              </circle>
            </g>
          </svg>

          <ul class="row-list" *ngIf="history()?.points?.length; else noPoints">
            <li *ngFor="let p of history()?.points">
              <div>
                <strong>{{ p.valueText }}{{ p.unit ? ' ' + p.unit : '' }}</strong>
                <span class="pill pill-danger" *ngIf="p.flag">{{ p.flag }}</span>
                <div class="muted small">{{ p.observedAt * 1000 | date: 'medium' }}</div>
              </div>
            </li>
          </ul>
          <ng-template #noPoints><p class="muted">No results recorded for this patient yet.</p></ng-template>
        </ng-container>
      </section>

      <section>
        <button type="button" class="danger" (click)="deleteAnalyte()" [disabled]="deleting()">
          {{ deleting() ? 'Deleting…' : 'Delete analyte' }}
        </button>
        <div class="error" *ngIf="deleteError()">{{ deleteError() }}</div>
      </section>
    </div>

    <ng-template #loadingOrError>
      <div class="card">
        <p class="error" *ngIf="loadError()">{{ loadError() }}</p>
        <p class="muted" *ngIf="!loadError()">Loading…</p>
      </div>
    </ng-template>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
      }
      section {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
      h2 {
        margin: 0 0 0.25rem;
      }
      h3 {
        margin: 0.6rem 0 0.2rem;
        font-size: 1rem;
      }
      .header-form,
      .stacked {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin: 0.5rem 0;
      }
      .row {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .grow {
        flex: 1;
        min-width: 6rem;
      }
      .chart {
        width: 100%;
        height: auto;
        margin: 0.6rem 0;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 8px;
      }
      /* The lab's own range reads as the ground the others sit on. */
      .range-band {
        fill: rgba(125, 211, 252, 0.12);
      }
      .custom-band {
        fill: rgba(74, 222, 128, 0.1);
      }
      .band-label {
        fill: var(--text-muted);
        font-size: 9px;
      }
      .value-line {
        fill: none;
        stroke: #7dd3fc;
        stroke-width: 2;
      }
      .value-point {
        fill: #7dd3fc;
      }
    `,
  ],
})
export class AnalyteDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly chartWidth = CHART_WIDTH;
  readonly chartHeight = CHART_HEIGHT;

  analyteId = '';
  analyte = signal<Analyte | null>(null);
  ranges = signal<AnalyteRange[]>([]);
  patients = signal<Patient[]>([]);
  patientId = signal<string | null>(null);
  history = signal<AnalyteHistory | null>(null);

  loadError = signal<string | null>(null);
  headerError = signal<string | null>(null);
  rangesError = signal<string | null>(null);
  patientsError = signal<string | null>(null);
  historyError = signal<string | null>(null);
  deleteError = signal<string | null>(null);

  savingHeader = signal(false);
  savingRange = signal(false);
  deleting = signal(false);
  showRangeForm = signal(false);

  headerForm = this.fb.group({ displayName: ['', Validators.required], unit: [''], panel: [''] });
  rangeForm = this.fb.group({
    label: ['', Validators.required],
    low: [null as number | null],
    high: [null as number | null],
    refText: [''],
    effectiveFrom: ['', Validators.required],
    source: [''],
    isReference: [false],
  });

  /**
   * Ranges grouped into lineages — successive versions of one named standard. Mirrors the API's
   * lineage key (kind + case-insensitive label) so "current" here means what it means server-side.
   */
  lineages = computed<Lineage[]>(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    const byKey = new Map<string, Lineage>();
    for (const r of this.ranges()) {
      const key = `${r.kind} ${r.label.trim().toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) existing.rows.push(r);
      else byKey.set(key, { key, label: r.label, kind: r.kind, rows: [r], currentId: null });
    }
    const out = Array.from(byKey.values());
    for (const lin of out) {
      lin.rows.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
      lin.currentId = lin.rows.find((r) => r.effectiveFrom <= nowTs)?.id ?? null;
    }
    out.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'reference' ? -1 : 1));
    return out;
  });

  private numericPoints = computed(() => (this.history()?.points ?? []).filter((p) => p.value !== null));

  /** Co-plotting mmol/L against mg/dL would draw a trend that isn't there. */
  mixedUnits = computed(() => {
    const units = new Set(this.numericPoints().map((p) => p.unit ?? ''));
    return units.size > 1;
  });

  private domain = computed(() => {
    const points = this.numericPoints();
    if (!points.length) return null;
    const times = points.map((p) => p.observedAt);
    const values: number[] = points.map((p) => p.value as number);
    // The chart is for reading a value against its standards, so the standards set the scale too —
    // every bound of every range, or a band the values never reach would be clipped off.
    for (const r of this.history()?.ranges ?? []) {
      if (r.low !== null) values.push(r.low);
      if (r.high !== null) values.push(r.high);
    }
    const minT = Math.min(...times);
    // The right edge is today, not the last result: a range that took effect with the newest
    // result would otherwise be zero-width and vanish, which is precisely the standard a reader
    // most needs to see. Ranges effective in the future stay off the chart until they apply.
    const maxT = Math.max(...times, Math.floor(Date.now() / 1000));
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    return {
      minT,
      maxT: maxT === minT ? minT + 1 : maxT,
      minV,
      maxV: maxV === minV ? minV + 1 : maxV,
    };
  });

  private xFor(ts: number): number {
    const d = this.domain();
    if (!d) return 0;
    return ((ts - d.minT) / (d.maxT - d.minT)) * CHART_WIDTH;
  }

  private yFor(value: number): number {
    const d = this.domain();
    if (!d) return 0;
    const usable = CHART_HEIGHT - PAD * 2;
    return CHART_HEIGHT - PAD - ((value - d.minV) / (d.maxV - d.minV)) * usable;
  }

  plotted = computed<PlottedPoint[]>(() =>
    this.numericPoints().map((p) => ({
      x: this.xFor(p.observedAt),
      y: this.yFor(p.value as number),
      valueText: p.valueText,
      unit: p.unit,
      observedAt: p.observedAt,
    })),
  );

  polylinePoints = computed(() => this.plotted().map((p) => `${p.x},${p.y}`).join(' '));

  /**
   * One band per row, spanning from its effective date to where the next row **in its own lineage**
   * takes over. Lineages are independent: a new reference range doesn't end a goal.
   */
  rangeBands = computed<RangeBand[]>(() => {
    const d = this.domain();
    if (!d) return [];
    const rows = this.history()?.ranges ?? [];
    const byLineage = new Map<string, AnalyteRange[]>();
    for (const r of rows) {
      const key = `${r.kind} ${r.label.trim().toLowerCase()}`;
      const bucket = byLineage.get(key);
      if (bucket) bucket.push(r);
      else byLineage.set(key, [r]);
    }

    const bands: RangeBand[] = [];
    for (const bucket of byLineage.values()) {
      const ordered = bucket.slice().sort((a, b) => a.effectiveFrom - b.effectiveFrom);
      ordered.forEach((r, i) => {
        if (r.low === null && r.high === null) return; // text-only: nothing to draw
        const startTs = Math.max(r.effectiveFrom, d.minT);
        const endTs = i + 1 < ordered.length ? Math.min(ordered[i + 1].effectiveFrom, d.maxT) : d.maxT;
        if (endTs <= startTs) return;
        // An open-ended range fills to the edge of the chart in that direction.
        const top = this.yFor(r.high ?? d.maxV);
        const bottom = this.yFor(r.low ?? d.minV);
        const x = this.xFor(startTs);
        bands.push({
          x,
          width: this.xFor(endTs) - x,
          y: top,
          height: Math.max(bottom - top, 1),
          label: `${r.label} ${this.describeRange(r)}`,
          reference: r.kind === 'reference',
          labelX: x + 4,
          labelY: top + 10,
        });
      });
    }
    return bands;
  });

  ngOnInit() {
    this.analyteId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadAnalyte();
    this.loadPatients();
  }

  private loadPatients() {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (rows) => this.patients.set(rows ?? []),
      error: (err) => this.patientsError.set(errorText(err, 'Could not load patients.')),
    });
  }

  describeRange(r: { low: number | null; high: number | null; refText: string | null }): string {
    if (r.low !== null && r.high !== null) return `${r.low}–${r.high}`;
    if (r.high !== null) return `at or below ${r.high}`;
    if (r.low !== null) return `at or above ${r.low}`;
    return r.refText ?? '—';
  }

  private loadAnalyte() {
    this.api.get<Analyte>(`/analytes/${this.analyteId}`).subscribe({
      next: (a) => {
        this.analyte.set(a);
        this.headerForm.patchValue({ displayName: a.displayName, unit: a.unit ?? '', panel: a.panel ?? '' });
      },
      error: (err) => this.loadError.set(errorText(err, 'Could not load this analyte.')),
    });
  }

  private loadRanges() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.rangesError.set(null);
    this.api.get<AnalyteRange[]>(`/patients/${patientId}/analytes/${this.analyteId}/ranges`).subscribe({
      next: (rows) => this.ranges.set(rows),
      error: (err) => this.rangesError.set(errorText(err, 'Could not load ranges.')),
    });
  }

  saveHeader() {
    if (this.headerForm.invalid) return;
    this.savingHeader.set(true);
    this.headerError.set(null);
    const val = this.headerForm.value;
    this.api
      .patch<Analyte>(`/analytes/${this.analyteId}`, {
        displayName: val.displayName,
        unit: val.unit?.trim() || null,
        panel: val.panel?.trim() || null,
      })
      .subscribe({
        next: (a) => {
          this.savingHeader.set(false);
          this.analyte.set(a);
        },
        error: (err) => {
          this.savingHeader.set(false);
          this.headerError.set(errorText(err, 'Could not save this analyte.'));
        },
      });
  }

  toggleRangeForm() {
    this.showRangeForm.set(!this.showRangeForm());
    this.rangesError.set(null);
  }

  addRange() {
    const patientId = this.patientId();
    if (this.rangeForm.invalid || !patientId) return;
    this.savingRange.set(true);
    this.rangesError.set(null);
    const val = this.rangeForm.value;
    this.api
      .post<AnalyteRange>(`/patients/${patientId}/analytes/${this.analyteId}/ranges`, {
        label: val.label,
        kind: val.isReference ? 'reference' : 'custom',
        low: val.low ?? undefined,
        high: val.high ?? undefined,
        refText: val.refText?.trim() || undefined,
        effectiveFrom: new Date(`${val.effectiveFrom}T00:00:00`).toISOString(),
        source: val.source?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.savingRange.set(false);
          this.showRangeForm.set(false);
          this.rangeForm.reset({
            label: '',
            low: null,
            high: null,
            refText: '',
            effectiveFrom: '',
            source: '',
            isReference: false,
          });
          this.loadRanges();
          this.loadHistory();
        },
        error: (err) => {
          this.savingRange.set(false);
          this.rangesError.set(errorText(err, 'Could not add the range.'));
        },
      });
  }

  deleteRange(id: string) {
    this.rangesError.set(null);
    this.api.delete(`/analyte-ranges/${id}`).subscribe({
      next: () => {
        this.loadRanges();
        this.loadHistory();
      },
      error: (err) => this.rangesError.set(errorText(err, 'Could not remove the range.')),
    });
  }

  selectPatient(patientId: string | null) {
    this.patientId.set(patientId);
    this.history.set(null);
    this.ranges.set([]);
    // Ranges and history both belong to the selected patient — they reload together.
    if (patientId) {
      this.loadRanges();
      this.loadHistory();
    }
  }

  private loadHistory() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.historyError.set(null);
    this.api.get<AnalyteHistory>(`/patients/${patientId}/analytes/${this.analyteId}/history`).subscribe({
      next: (h) => this.history.set(h),
      error: (err) => this.historyError.set(errorText(err, 'Could not load this analyte’s history.')),
    });
  }

  deleteAnalyte() {
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api.delete(`/analytes/${this.analyteId}`).subscribe({
      next: () => this.router.navigate(['/analytes']),
      error: (err) => {
        this.deleting.set(false);
        this.deleteError.set(errorText(err, 'Could not delete this analyte.'));
      },
    });
  }

  back() {
    this.router.navigate(['/analytes']);
  }
}
