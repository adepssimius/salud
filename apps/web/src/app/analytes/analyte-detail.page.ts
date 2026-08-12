import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Analyte, AnalyteHistory, AnalyteReferenceRange, Patient } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';

interface PlottedPoint {
  x: number;
  y: number;
  valueText: string;
  unit: string | null;
  observedAt: number;
}

interface RangeBand {
  x: number;
  width: number;
  y: number;
  height: number;
  label: string;
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
        <h2>Reference ranges</h2>
        <p class="muted small">
          The standard a result is read against, dated: each range applies from its start until the
          next one begins, so an old result keeps being read against the standard of its day.
        </p>
        <div class="error" *ngIf="rangesError()">{{ rangesError() }}</div>
        <ul class="row-list" *ngIf="ranges().length; else noRanges">
          <li *ngFor="let r of ranges()">
            <div>
              <strong>{{ describeRange(r) }}</strong>
              <span class="pill pill-success" *ngIf="r.id === currentRangeId()">current</span>
              <div class="muted small">
                from {{ r.effectiveFrom * 1000 | date: 'mediumDate' }}<span *ngIf="r.source"> · {{ r.source }}</span>
              </div>
            </div>
            <button type="button" class="secondary" (click)="deleteRange(r.id)">Remove</button>
          </li>
        </ul>
        <ng-template #noRanges><p class="muted">No reference range recorded yet.</p></ng-template>

        <button type="button" class="secondary" (click)="toggleRangeForm()">
          {{ showRangeForm() ? 'Cancel' : '+ Add reference range' }}
        </button>
        <form *ngIf="showRangeForm()" [formGroup]="rangeForm" (ngSubmit)="addRange()" class="stacked">
          <div class="row">
            <label class="field grow">
              <span>Low</span>
              <input type="number" step="any" formControlName="refLow" />
            </label>
            <label class="field grow">
              <span>High</span>
              <input type="number" step="any" formControlName="refHigh" />
            </label>
          </div>
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
          <button type="submit" class="primary" [disabled]="rangeForm.invalid || savingRange()">
            {{ savingRange() ? 'Saving…' : 'Add range' }}
          </button>
        </form>
      </section>

      <section>
        <h2>Per-patient goal and history</h2>
        <label class="field">
          <span>Patient</span>
          <select [ngModel]="patientId()" (ngModelChange)="selectPatient($event)" [ngModelOptions]="{ standalone: true }">
            <option [ngValue]="null">—</option>
            <option *ngFor="let p of patients()" [ngValue]="p.id">{{ p.fullName }}</option>
          </select>
        </label>
        <div class="error" *ngIf="patientsError()">{{ patientsError() }}</div>

        <ng-container *ngIf="patientId()">
          <form [formGroup]="goalForm" (ngSubmit)="saveGoal()" class="stacked">
            <div class="row">
              <label class="field grow">
                <span>Goal at or above</span>
                <input type="number" step="any" formControlName="goalLow" />
              </label>
              <label class="field grow">
                <span>Goal at or below</span>
                <input type="number" step="any" formControlName="goalHigh" />
              </label>
            </div>
            <label class="field">
              <span>Why</span>
              <input type="text" formControlName="note" placeholder="athletic target" />
            </label>
            <div class="row">
              <button type="submit" class="primary" [disabled]="savingGoal()">
                {{ savingGoal() ? 'Saving…' : 'Save goal' }}
              </button>
              <button type="button" class="secondary" *ngIf="hasGoal()" (click)="clearGoal()">Clear goal</button>
            </div>
          </form>
          <p class="muted small">
            A goal is yours, not the lab's: it is shown alongside results and never recorded onto one.
          </p>
          <div class="error" *ngIf="goalError()">{{ goalError() }}</div>

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
            <rect
              *ngFor="let band of rangeBands()"
              [attr.x]="band.x"
              [attr.y]="band.y"
              [attr.width]="band.width"
              [attr.height]="band.height"
              class="range-band"
            >
              <title>{{ band.label }}</title>
            </rect>
            <line
              *ngFor="let g of goalLines()"
              [attr.x1]="0"
              [attr.y1]="g.y"
              [attr.x2]="chartWidth"
              [attr.y2]="g.y"
              class="goal-line"
            >
              <title>{{ g.label }}</title>
            </line>
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
      .range-band {
        fill: rgba(125, 211, 252, 0.12);
      }
      .goal-line {
        stroke: #4ade80;
        stroke-width: 1.5;
        stroke-dasharray: 6 4;
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
  ranges = signal<AnalyteReferenceRange[]>([]);
  patients = signal<Patient[]>([]);
  patientId = signal<string | null>(null);
  history = signal<AnalyteHistory | null>(null);

  loadError = signal<string | null>(null);
  headerError = signal<string | null>(null);
  rangesError = signal<string | null>(null);
  patientsError = signal<string | null>(null);
  goalError = signal<string | null>(null);
  historyError = signal<string | null>(null);
  deleteError = signal<string | null>(null);

  savingHeader = signal(false);
  savingRange = signal(false);
  savingGoal = signal(false);
  deleting = signal(false);
  showRangeForm = signal(false);
  hasGoal = signal(false);

  headerForm = this.fb.group({ displayName: ['', Validators.required], unit: [''], panel: [''] });
  rangeForm = this.fb.group({
    refLow: [null as number | null],
    refHigh: [null as number | null],
    refText: [''],
    effectiveFrom: ['', Validators.required],
    source: [''],
  });
  goalForm = this.fb.group({
    goalLow: [null as number | null],
    goalHigh: [null as number | null],
    note: [''],
  });

  /** The range in effect now — the same "greatest effectiveFrom at or before" rule the API uses. */
  currentRangeId = computed<string | null>(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    let winner: AnalyteReferenceRange | null = null;
    for (const r of this.ranges()) {
      if (r.effectiveFrom > nowTs) continue;
      if (!winner || r.effectiveFrom > winner.effectiveFrom) winner = r;
    }
    return winner?.id ?? null;
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
    // The chart is for reading a value against its standards, so the standards set the scale too.
    for (const r of this.history()?.ranges ?? []) {
      if (r.refLow !== null) values.push(r.refLow);
      if (r.refHigh !== null) values.push(r.refHigh);
    }
    const goal = this.history()?.goal;
    if (goal?.goalLow != null) values.push(goal.goalLow);
    if (goal?.goalHigh != null) values.push(goal.goalHigh);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
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

  /** One band per range, spanning from its effective date to where the next one takes over. */
  rangeBands = computed<RangeBand[]>(() => {
    const d = this.domain();
    const ranges = this.history()?.ranges ?? [];
    if (!d) return [];
    const bands: RangeBand[] = [];
    ranges.forEach((r, i) => {
      if (r.refLow === null && r.refHigh === null) return; // text-only range: nothing to draw
      const startTs = Math.max(r.effectiveFrom, d.minT);
      const endTs = i + 1 < ranges.length ? Math.min(ranges[i + 1].effectiveFrom, d.maxT) : d.maxT;
      if (endTs <= startTs) return;
      const top = this.yFor(r.refHigh ?? d.maxV);
      const bottom = this.yFor(r.refLow ?? d.minV);
      bands.push({
        x: this.xFor(startTs),
        width: this.xFor(endTs) - this.xFor(startTs),
        y: top,
        height: Math.max(bottom - top, 1),
        label: `Reference ${this.describeRange(r)}`,
      });
    });
    return bands;
  });

  goalLines = computed(() => {
    const goal = this.history()?.goal;
    if (!goal || !this.domain()) return [];
    const lines: Array<{ y: number; label: string }> = [];
    if (goal.goalLow != null) lines.push({ y: this.yFor(goal.goalLow), label: `Goal at or above ${goal.goalLow}` });
    if (goal.goalHigh != null) lines.push({ y: this.yFor(goal.goalHigh), label: `Goal at or below ${goal.goalHigh}` });
    return lines;
  });

  ngOnInit() {
    this.analyteId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadAnalyte();
    this.loadRanges();
    this.api.get<Patient[]>('/patients').subscribe({
      next: (rows) => this.patients.set(rows),
      error: (err) => this.patientsError.set(errorText(err, 'Could not load patients.')),
    });
  }

  describeRange(r: { refLow: number | null; refHigh: number | null; refText: string | null }): string {
    if (r.refLow !== null && r.refHigh !== null) return `${r.refLow}–${r.refHigh}`;
    if (r.refHigh !== null) return `at or below ${r.refHigh}`;
    if (r.refLow !== null) return `at or above ${r.refLow}`;
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
    this.rangesError.set(null);
    this.api.get<AnalyteReferenceRange[]>(`/analytes/${this.analyteId}/reference-ranges`).subscribe({
      next: (rows) => this.ranges.set(rows),
      error: (err) => this.rangesError.set(errorText(err, 'Could not load reference ranges.')),
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
    if (this.rangeForm.invalid) return;
    this.savingRange.set(true);
    this.rangesError.set(null);
    const val = this.rangeForm.value;
    this.api
      .post<AnalyteReferenceRange>(`/analytes/${this.analyteId}/reference-ranges`, {
        refLow: val.refLow ?? undefined,
        refHigh: val.refHigh ?? undefined,
        refText: val.refText?.trim() || undefined,
        effectiveFrom: new Date(`${val.effectiveFrom}T00:00:00`).toISOString(),
        source: val.source?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.savingRange.set(false);
          this.showRangeForm.set(false);
          this.rangeForm.reset({ refLow: null, refHigh: null, refText: '', effectiveFrom: '', source: '' });
          this.loadRanges();
          this.loadHistory();
        },
        error: (err) => {
          this.savingRange.set(false);
          this.rangesError.set(errorText(err, 'Could not add the reference range.'));
        },
      });
  }

  deleteRange(id: string) {
    this.rangesError.set(null);
    this.api.delete(`/reference-ranges/${id}`).subscribe({
      next: () => {
        this.loadRanges();
        this.loadHistory();
      },
      error: (err) => this.rangesError.set(errorText(err, 'Could not remove the reference range.')),
    });
  }

  selectPatient(patientId: string | null) {
    this.patientId.set(patientId);
    this.history.set(null);
    this.hasGoal.set(false);
    this.goalForm.reset({ goalLow: null, goalHigh: null, note: '' });
    if (patientId) this.loadHistory();
  }

  private loadHistory() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.historyError.set(null);
    this.api.get<AnalyteHistory>(`/patients/${patientId}/analytes/${this.analyteId}/history`).subscribe({
      next: (h) => {
        this.history.set(h);
        this.hasGoal.set(!!h.goal);
        this.goalForm.patchValue({
          goalLow: h.goal?.goalLow ?? null,
          goalHigh: h.goal?.goalHigh ?? null,
          note: h.goal?.note ?? '',
        });
      },
      error: (err) => this.historyError.set(errorText(err, 'Could not load this analyte’s history.')),
    });
  }

  saveGoal() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.savingGoal.set(true);
    this.goalError.set(null);
    const val = this.goalForm.value;
    this.api
      .put(`/patients/${patientId}/analyte-goals/${this.analyteId}`, {
        goalLow: val.goalLow ?? undefined,
        goalHigh: val.goalHigh ?? undefined,
        note: val.note?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.savingGoal.set(false);
          this.loadHistory();
        },
        error: (err) => {
          this.savingGoal.set(false);
          this.goalError.set(errorText(err, 'Could not save the goal.'));
        },
      });
  }

  clearGoal() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.goalError.set(null);
    this.api.delete(`/patients/${patientId}/analyte-goals/${this.analyteId}`).subscribe({
      next: () => {
        this.goalForm.reset({ goalLow: null, goalHigh: null, note: '' });
        this.hasGoal.set(false);
        this.loadHistory();
      },
      error: (err) => this.goalError.set(errorText(err, 'Could not clear the goal.')),
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
