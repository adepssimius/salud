import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import {
  AnalyteReferenceRange,
  CreateObservationDto,
  LabAnalyteResolution,
  LabImportResult,
  Observation,
  ParsedLabAnalyte,
  Patient,
  ResolveAnalytesResult,
  UploadFileResponse,
} from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';

interface AnalyteRow {
  analyte: ParsedLabAnalyte;
  resolution: LabAnalyteResolution;
  selected: boolean;
  // Only meaningful on a `conflict` row: whether to write the report's range into the catalog.
  // Default false — the catalog is not overwritten by an import unless asked.
  updateCatalog: boolean;
}

interface PanelGroup {
  panel: string | null;
  rows: AnalyteRow[];
}

// Upload → parse → preview → confirm (frontend.md → "Lab import"). Nothing is recorded until the
// caregiver confirms; the confirm step is a plain observation create — lab_result entries plus a
// document entry pointing at the uploaded PDF. The preview is deselect-only: a mis-parsed row is
// unchecked, never retyped, so the record can't carry a hand-corrected number silently attributed
// to the lab. The PDF itself is the source of truth and stays attached either way.
@Component({
  selector: 'app-lab-import-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page">
      <div class="card">
        <div class="card-header">
          <div>
            <h1>Import lab report</h1>
            <p class="muted" *ngIf="patient() as p">
              For {{ p.fullName }} —
              <button type="button" class="link linklike" (click)="backToPatient()">back to patient</button>
            </p>
          </div>
        </div>

        <ng-container *ngIf="phase() === 'upload'">
          <p class="muted">
            Upload the lab's original PDF (Quest Diagnostics supported today). You'll review every
            value before anything is recorded.
          </p>
          <label class="field">
            <span>Report PDF</span>
            <input type="file" accept="application/pdf" (change)="onFileSelected($event)" [disabled]="busy()" />
          </label>
          <div class="muted small" *ngIf="busy()">{{ busyText() }}</div>
          <div class="error" *ngIf="error()">{{ error() }}</div>
          <p class="muted small" *ngIf="uploadedFileId() && error()">
            The PDF was saved; fix the problem and choose it again, or try a different file.
          </p>
        </ng-container>

        <ng-container *ngIf="phase() === 'preview' && parsed() as report">
          <div class="review-header">
            <div>
              <h2>{{ report.labName || 'Lab report' }}</h2>
              <p class="muted small">
                <span *ngIf="report.specimenId">Specimen {{ report.specimenId }} · </span>
                <span *ngIf="report.collectedAt">Collected {{ report.collectedAt | date: 'medium' }} · </span>
                <span *ngIf="report.reportedAt">Reported {{ report.reportedAt | date: 'medium' }}</span>
                <span *ngIf="report.orderingProvider"> · Ordered by {{ report.orderingProvider }}</span>
              </p>
              <p class="muted small" *ngIf="report.patientName">
                Report is for <strong>{{ report.patientName }}</strong> — check this matches
                {{ patient()?.fullName || 'this patient' }}. The printed name is not saved.
              </p>
            </div>
          </div>

          <div class="warnings" *ngIf="report.warnings.length">
            <p class="small"><strong>{{ report.warnings.length }}</strong> lines couldn't be read as results. Anything
              important among them is still in the attached PDF:</p>
            <ul class="small muted">
              <li *ngFor="let w of report.warnings">{{ w }}</li>
            </ul>
          </div>

          <div class="table-wrap" *ngIf="groups().length">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Analyte</th>
                  <th>Value</th>
                  <th>Flag</th>
                  <th>Reference</th>
                  <th>Goal</th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let g of groups()">
                  <tr class="panel-row" *ngIf="g.panel">
                    <td colspan="6">{{ g.panel }}</td>
                  </tr>
                  <ng-container *ngFor="let row of g.rows">
                    <tr [class.deselected]="!row.selected">
                      <td>
                        <input type="checkbox" [(ngModel)]="row.selected" [ngModelOptions]="{ standalone: true }" />
                      </td>
                      <td>
                        {{ row.resolution.displayName || row.analyte.analyte }}
                        <span class="pill pill-neutral" *ngIf="row.resolution.status === 'new'">new</span>
                        <span class="pill pill-neutral" *ngIf="row.resolution.status === 'new_range'">new range</span>
                      </td>
                      <td [class.out-of-range]="isOutOfRange(row.analyte)" [class.off-goal]="isOffGoal(row)">
                        {{ row.analyte.valueText }}<span *ngIf="row.analyte.unit"> {{ row.analyte.unit }}</span>
                      </td>
                      <td>
                        <span class="pill pill-danger" *ngIf="row.analyte.flag">{{ row.analyte.flag }}</span>
                      </td>
                      <td class="muted small">{{ referenceText(row.analyte) }}</td>
                      <td class="muted small">{{ goalText(row) }}</td>
                    </tr>
                    <!-- The report and the catalog disagree. Which one is right is the caregiver's
                         call, so it is asked rather than assumed, and unchecked by default. -->
                    <tr class="conflict-row" *ngIf="row.selected && row.resolution.status === 'conflict'">
                      <td></td>
                      <td colspan="5">
                        <label class="inline-check">
                          <input
                            type="checkbox"
                            [(ngModel)]="row.updateCatalog"
                            [ngModelOptions]="{ standalone: true }"
                          />
                          <span class="small">
                            The catalog says {{ catalogRangeText(row) }} for this analyte, this report says
                            {{ referenceText(row.analyte) }}. Update the catalog to the report's range?
                          </span>
                        </label>
                      </td>
                    </tr>
                  </ng-container>
                </ng-container>
              </tbody>
            </table>
          </div>
          <p class="muted" *ngIf="!groups().length">
            No results could be read from this PDF. The file itself was saved — you can still attach
            it to an observation from the entry form.
          </p>

          <div class="confirm-fields">
            <label class="field">
              <span>Observed at (specimen collection time)</span>
              <input type="datetime-local" [(ngModel)]="observedAtLocal" name="observedAtLocal" />
            </label>
            <label class="field">
              <span>Observation note</span>
              <input type="text" [(ngModel)]="summaryText" name="summaryText" />
            </label>
            <label class="field">
              <span>Attached PDF label</span>
              <input type="text" [(ngModel)]="documentLabel" name="documentLabel" />
            </label>
          </div>

          <div class="error" *ngIf="error()">{{ error() }}</div>

          <div class="actions">
            <button class="primary" type="button" (click)="confirm()" [disabled]="busy() || !selectedCount()">
              {{ busy() ? 'Saving…' : 'Record ' + selectedCount() + ' result' + (selectedCount() === 1 ? '' : 's') }}
            </button>
            <button class="secondary" type="button" (click)="startOver()" [disabled]="busy()">Start over</button>
            <span class="muted small">The original PDF is attached either way.</span>
          </div>
        </ng-container>
      </div>
    </section>
  `,
  styles: [
    `
      .review-header h2 {
        margin-bottom: 0.15rem;
      }
      .warnings {
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 0.6rem 0.8rem;
        margin: 0.6rem 0;
      }
      .warnings ul {
        margin: 0.3rem 0 0;
        padding-left: 1.1rem;
        max-height: 8rem;
        overflow-y: auto;
      }
      .table-wrap {
        overflow-x: auto;
        margin: 0.6rem 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 0.35rem 0.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .panel-row td {
        font-weight: 700;
        padding-top: 0.7rem;
        border-bottom: none;
        color: var(--text-muted);
        text-transform: none;
      }
      tr.deselected td {
        opacity: 0.45;
      }
      /* Display-time hints only — the record keeps what the lab printed (P6). */
      td.out-of-range {
        color: var(--danger-text);
      }
      td.off-goal {
        text-decoration: underline dotted;
        text-underline-offset: 3px;
      }
      .conflict-row td {
        border-bottom: none;
        padding-top: 0;
      }
      .confirm-fields {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        margin-top: 0.6rem;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-top: 0.8rem;
        flex-wrap: wrap;
      }
      .linklike {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        cursor: pointer;
      }
    `,
  ],
})
export class LabImportPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = '';
  patient = signal<Patient | null>(null);

  phase = signal<'upload' | 'preview'>('upload');
  busy = signal(false);
  busyText = signal('');
  error = signal<string | null>(null);

  uploadedFileId = signal<string | null>(null);
  parsed = signal<LabImportResult['parsed'] | null>(null);
  rows = signal<AnalyteRow[]>([]);

  observedAtLocal = '';
  summaryText = '';
  documentLabel = '';

  groups = computed<PanelGroup[]>(() => {
    const out: PanelGroup[] = [];
    for (const row of this.rows()) {
      const last = out[out.length - 1];
      if (last && last.panel === row.analyte.panel) last.rows.push(row);
      else out.push({ panel: row.analyte.panel, rows: [row] });
    }
    return out;
  });

  selectedCount = () => this.rows().filter((r) => r.selected).length;

  ngOnInit() {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.get<Patient>(`/patients/${this.patientId}`).subscribe({
      next: (p) => this.patient.set(p),
      error: (err) => this.error.set(errorText(err, 'Could not load this patient.')),
    });
  }

  isOutOfRange(a: ParsedLabAnalyte): boolean {
    if (a.value === null) return false;
    if (a.refLow !== null && a.value < a.refLow) return true;
    if (a.refHigh !== null && a.value > a.refHigh) return true;
    return false;
  }

  // Display-only, like isOutOfRange: a goal never becomes part of the record (P6).
  isOffGoal(row: AnalyteRow): boolean {
    const goal = row.resolution.goal;
    const value = row.analyte.value;
    if (!goal || value === null) return false;
    if (goal.goalLow != null && value < goal.goalLow) return true;
    if (goal.goalHigh != null && value > goal.goalHigh) return true;
    return false;
  }

  referenceText(a: { refLow: number | null; refHigh: number | null; refText: string | null; unit?: string | null }): string {
    if (a.refLow !== null && a.refHigh !== null) return `${a.refLow}–${a.refHigh}${a.unit ? ' ' + a.unit : ''}`;
    if (a.refText) return a.refText;
    if (a.refHigh !== null) return `at or below ${a.refHigh}`;
    if (a.refLow !== null) return `at or above ${a.refLow}`;
    return '—';
  }

  catalogRangeText(row: AnalyteRow): string {
    const range = row.resolution.catalogRange;
    return range ? this.referenceText(range) : '—';
  }

  goalText(row: AnalyteRow): string {
    const goal = row.resolution.goal;
    if (!goal) return '';
    if (goal.goalLow != null && goal.goalHigh != null) return `${goal.goalLow}–${goal.goalHigh}`;
    if (goal.goalLow != null) return `at or above ${goal.goalLow}`;
    if (goal.goalHigh != null) return `at or below ${goal.goalHigh}`;
    return '';
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);
    this.busyText.set('Uploading PDF…');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('patientId', this.patientId);
    this.api.post<UploadFileResponse>('/files', formData).subscribe({
      next: (res) => {
        this.uploadedFileId.set(res.fileId);
        this.documentLabel = file.name;
        this.parseUploaded(res.fileId);
      },
      error: (err) => {
        this.busy.set(false);
        input.value = '';
        this.error.set(errorText(err, 'Could not upload the PDF.'));
      },
    });
  }

  private parseUploaded(fileId: string) {
    this.busyText.set('Reading the report…');
    this.api.post<LabImportResult>(`/patients/${this.patientId}/lab-imports`, { fileId }).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.parsed.set(res.parsed);
        // resolutions is index-aligned with parsed.analytes (api.md → Lab imports).
        this.rows.set(
          res.parsed.analytes.map((analyte, i) => ({
            analyte,
            resolution: res.resolutions[i],
            selected: true,
            updateCatalog: false,
          })),
        );
        this.observedAtLocal = this.toLocalInput(res.parsed.collectedAt ?? new Date().toISOString());
        this.summaryText = this.buildSummary(res.parsed);
        this.phase.set('preview');
      },
      error: (err) => {
        this.busy.set(false);
        // The upload above already succeeded — say so, or a retry looks like it must start over.
        this.error.set(errorText(err, 'Could not read that PDF as a lab report.'));
      },
    });
  }

  private buildSummary(parsed: LabImportResult['parsed']): string {
    const bits = [`${parsed.labName ?? 'Lab'} labs`];
    if (parsed.specimenId) bits.push(`specimen ${parsed.specimenId}`);
    if (parsed.collectedAt) bits.push(`collected ${new Date(parsed.collectedAt).toLocaleDateString()}`);
    return bits.join(' — ');
  }

  private toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Three requests, in order: resolve the selected names to analyte ids (creating any new ones),
   * write the reference ranges that are additive or that the caregiver accepted, then create the
   * observation. Only the last one records measurements.
   *
   * If the observation create fails, catalog rows may already exist. That is harmless — they are
   * the catalog's, not this report's — and retrying is safe: resolve returns the same ids, and a
   * range identical to the one already in effect is a no-op server-side.
   */
  confirm() {
    const fileId = this.uploadedFileId();
    const selected = this.rows().filter((r) => r.selected);
    if (!fileId || !selected.length) return;
    if (!this.observedAtLocal) {
      this.error.set('Set the collection date and time.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    const observedAt = new Date(this.observedAtLocal).toISOString();

    this.api
      .post<ResolveAnalytesResult[]>('/analytes/resolve', {
        // The panel and unit the report printed travel with the name, so a catalog entry created
        // here reads as "% Saturation (Iron and Total Iron Binding Capacity)" rather than a bare
        // name with no context. Existing entries are left alone.
        analytes: selected.map((r) => ({
          name: r.analyte.analyte,
          unit: r.analyte.unit,
          panel: r.analyte.panel,
        })),
      })
      .pipe(
        switchMap((resolved) => {
          const idByName = new Map(resolved.map((r) => [r.name, r.analyteId]));
          const rangeWrites = selected
            .filter((row) => this.shouldWriteRange(row))
            .map((row) =>
              this.api.post<AnalyteReferenceRange>(`/analytes/${idByName.get(row.analyte.analyte)}/reference-ranges`, {
                refLow: row.analyte.refLow ?? undefined,
                refHigh: row.analyte.refHigh ?? undefined,
                refText: row.analyte.refText ?? undefined,
                // The observation's own time, so the range resolves against this very result.
                effectiveFrom: observedAt,
                source: this.rangeSource(),
              }),
            );
          return (rangeWrites.length ? forkJoin(rangeWrites) : of([])).pipe(switchMap(() => of(idByName)));
        }),
        switchMap((idByName) => {
          const body: CreateObservationDto = {
            observedAt,
            text: this.summaryText.trim() || undefined,
            entries: [
              // An explicit field pick, not a spread of the parsed analyte: the printed reference
              // range is evidence for the catalog comparison, and the entry schema rejects it.
              ...selected.map((r) => ({
                type: 'lab_result' as const,
                metadata: {
                  analyteId: idByName.get(r.analyte.analyte) as string,
                  analyte: r.analyte.analyte,
                  valueText: r.analyte.valueText,
                  value: r.analyte.value,
                  unit: r.analyte.unit,
                  flag: r.analyte.flag,
                  panel: r.analyte.panel,
                },
              })),
              { type: 'document' as const, metadata: { fileId, label: this.documentLabel.trim() || undefined } },
            ],
          };
          return this.api.post<Observation>(`/patients/${this.patientId}/observations`, body);
        }),
      )
      .subscribe({
        next: () => this.router.navigate(['/patients', this.patientId, 'timeline']),
        error: (err) => {
          this.busy.set(false);
          this.error.set(errorText(err, 'Could not record the lab results.'));
        },
      });
  }

  private shouldWriteRange(row: AnalyteRow): boolean {
    const printsRange =
      row.analyte.refLow !== null || row.analyte.refHigh !== null || !!row.analyte.refText;
    if (!printsRange) return false;
    const status = row.resolution.status;
    // Additive cases need no permission; a conflict overwrites what the catalog already says.
    if (status === 'new' || status === 'new_range') return true;
    return status === 'conflict' && row.updateCatalog;
  }

  private rangeSource(): string {
    const parsed = this.parsed();
    const lab = parsed?.labName ?? 'Lab';
    return parsed?.specimenId ? `${lab} report ${parsed.specimenId}` : `${lab} report`;
  }

  startOver() {
    this.phase.set('upload');
    this.parsed.set(null);
    this.rows.set([]);
    this.uploadedFileId.set(null);
    this.error.set(null);
  }

  backToPatient() {
    this.router.navigate(['/patients', this.patientId]);
  }
}
