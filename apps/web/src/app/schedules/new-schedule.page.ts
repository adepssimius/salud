import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import {
  CreateScheduleDto,
  InterventionSchedule,
  Medication,
  MedicationEmbodiment,
  Patient,
  ScheduleType,
} from '@salud/shared/types';

@Component({
  selector: 'app-new-schedule-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <h1>New Schedule</h1>
      <p class="muted">
        Intent, not an event — "amoxicillin 400 mg every 8 h for 10 doses." Log the actual doses
        from the dashboard as they happen.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Patient</span>
          <select formControlName="patientId" (change)="onPatientChange($event)">
            <option value="">Select a patient</option>
            <option *ngFor="let p of patients()" [value]="p.id">{{ p.fullName }}</option>
          </select>
        </label>

        <label class="field">
          <span>Label</span>
          <input type="text" formControlName="label" placeholder="Amoxicillin q8h" />
        </label>

        <div class="grid">
          <label class="field">
            <span>Type</span>
            <select formControlName="type">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
          <label class="field" *ngIf="!prefillConditionId">
            <span>Episode (optional)</span>
            <select formControlName="episodeId">
              <option value="">None</option>
              <option *ngFor="let ep of activeEpisodes()" [value]="ep.id">{{ ep.name }}</option>
            </select>
          </label>
          <p class="muted condition-note" *ngIf="prefillConditionId">
            Linked to this Condition's standing regimen.
          </p>
        </div>

        <ng-container *ngIf="isMedication()">
          <div class="grid">
            <div class="field med-search">
              <span>Medication</span>
              <ng-container *ngIf="!selectedMedication(); else medicationChosen">
                <input
                  type="text"
                  placeholder="Search by generic or brand name…"
                  [value]="medicationQuery()"
                  (input)="onMedicationQueryChange($event)"
                />
                <ul class="med-results" *ngIf="medicationResults().length">
                  <li *ngFor="let m of medicationResults()">
                    <button type="button" class="med-result" (click)="selectMedication(m)">
                      <strong>{{ m.name }}</strong>
                      <span class="muted" *ngIf="m.brandNames.length"> — {{ m.brandNames.join(', ') }}</span>
                    </button>
                  </li>
                </ul>
              </ng-container>
              <ng-template #medicationChosen>
                <div class="chosen-med">
                  <span>{{ selectedMedication()!.name }}</span>
                  <button type="button" class="link" (click)="clearMedication()">change</button>
                </div>
              </ng-template>
            </div>
            <label class="field">
              <span>Embodiment</span>
              <select formControlName="medicationEmbodimentId" [disabled]="!embodiments().length">
                <option value="">{{ selectedMedication() ? 'Select…' : 'Choose a medication first' }}</option>
                <option *ngFor="let e of embodiments()" [value]="e.id">{{ e.label }}</option>
              </select>
            </label>
          </div>
          <div class="grid">
            <label class="field">
              <span>Dose (mg)</span>
              <input type="number" step="0.01" formControlName="doseMg" />
            </label>
            <label class="field">
              <span>Dose (mL)</span>
              <input type="number" step="0.01" formControlName="doseMl" />
            </label>
            <label class="field">
              <span>Pill count</span>
              <input type="number" step="0.5" formControlName="pillCount" />
            </label>
          </div>
        </ng-container>

        <ng-container *ngIf="!isMedication()">
          <div class="grid">
            <label class="field">
              <span>Body location</span>
              <input type="text" formControlName="bodyLocation" />
            </label>
            <label class="field">
              <span>Side</span>
              <select formControlName="side">
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="bilateral">Bilateral</option>
                <option value="n/a">N/A</option>
              </select>
            </label>
            <label class="field">
              <span>Dressing type</span>
              <input type="text" formControlName="dressingType" />
            </label>
          </div>
        </ng-container>

        <div class="grid">
          <label class="field">
            <span>Frequency (hours)</span>
            <input type="number" step="0.5" formControlName="frequencyHours" placeholder="e.g. 8" />
          </label>
          <label class="field">
            <span>— or fixed times (comma separated, 24h)</span>
            <input type="text" formControlName="explicitTimesRaw" placeholder="08:00, 16:00, 00:00" />
          </label>
        </div>

        <div class="grid">
          <label class="field">
            <span>Start</span>
            <input type="datetime-local" formControlName="startAt" />
          </label>
          <label class="field">
            <span>End after N doses (optional)</span>
            <input type="number" formControlName="endAfterOccurrences" />
          </label>
          <label class="field">
            <span>End date (optional)</span>
            <input type="datetime-local" formControlName="endAt" />
          </label>
        </div>

        <label class="field">
          <span>Notes</span>
          <textarea rows="2" formControlName="notes"></textarea>
        </label>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Create schedule' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .muted {
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
      }
      .med-search {
        position: relative;
      }
      .med-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 10;
        list-style: none;
        margin: 0.25rem 0 0;
        padding: 0.25rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #0b1224;
        max-height: 220px;
        overflow-y: auto;
      }
      .med-result {
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.6rem;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .med-result:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .chosen-med {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
      }
      .link {
        font-size: 0.85rem;
      }
    `,
  ],
})
export class NewSchedulePage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  prefillConditionId: string | null = null;
  prefillPatientId: string | null = null;

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<Array<{ id: string; name: string }>>([]);
  saving = signal(false);
  error = signal<string | null>(null);

  medicationQuery = signal('');
  medicationResults = signal<Medication[]>([]);
  selectedMedication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);

  form = this.fb.nonNullable.group({
    patientId: ['', Validators.required],
    label: ['', Validators.required],
    type: this.fb.control<ScheduleType>('medication_dose', { nonNullable: true }),
    episodeId: [''],
    conditionId: [''],
    medicationId: [''],
    medicationEmbodimentId: [''],
    doseMg: [null as number | null],
    doseMl: [null as number | null],
    pillCount: [null as number | null],
    bodyLocation: [''],
    side: ['n/a'],
    dressingType: [''],
    frequencyHours: [null as number | null],
    explicitTimesRaw: [''],
    startAt: [this.defaultDateTime(), Validators.required],
    endAfterOccurrences: [null as number | null],
    endAt: [''],
    notes: [''],
  });

  isMedication = computed(() => this.form.controls.type.value === 'medication_dose');

  ngOnInit(): void {
    this.prefillConditionId = this.route.snapshot.queryParamMap.get('conditionId');
    this.prefillPatientId = this.route.snapshot.queryParamMap.get('patientId');
    if (this.prefillConditionId) {
      this.form.patchValue({ conditionId: this.prefillConditionId });
    }

    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadPatients(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadPatients();
    }
  }

  private defaultDateTime() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  private loadPatients() {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (res) => {
        this.patients.set(res);
        const current = this.form.getRawValue().patientId;
        const pid = this.prefillPatientId || current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          if (!this.prefillConditionId) this.loadEpisodes(pid);
        }
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load patients.')),
    });
  }

  private loadEpisodes(patientId: string) {
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => this.activeEpisodes.set(eps),
      error: () => this.activeEpisodes.set([]),
    });
  }

  onPatientChange(event: Event) {
    const pid = (event.target as HTMLSelectElement).value;
    if (pid) {
      this.form.patchValue({ patientId: pid });
      this.loadEpisodes(pid);
    }
  }

  onMedicationQueryChange(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.medicationQuery.set(q);
    if (!q) {
      this.medicationResults.set([]);
      return;
    }
    this.api.get<Medication[]>('/medications', { q }).subscribe({
      next: (res) => this.medicationResults.set(res),
      error: () => this.medicationResults.set([]),
    });
  }

  selectMedication(medication: Medication) {
    this.selectedMedication.set(medication);
    this.medicationResults.set([]);
    this.medicationQuery.set('');
    this.form.patchValue({ medicationId: medication.id, medicationEmbodimentId: '' });
    this.embodiments.set([]);
    this.api.get<MedicationEmbodiment[]>(`/medications/${medication.id}/embodiments`).subscribe({
      next: (res) => this.embodiments.set(res),
      error: () => this.embodiments.set([]),
    });
  }

  clearMedication() {
    this.selectedMedication.set(null);
    this.embodiments.set([]);
    this.form.patchValue({ medicationId: '', medicationEmbodimentId: '' });
  }

  submit() {
    if (this.form.invalid || this.saving()) return;
    const val = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);

    const explicitTimes = val.explicitTimesRaw
      ? val.explicitTimesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const body: CreateScheduleDto = {
      type: val.type,
      label: val.label,
      episodeId: val.conditionId ? undefined : val.episodeId || undefined,
      conditionId: val.conditionId || undefined,
      startAt: new Date(val.startAt).toISOString(),
      frequencyHours: explicitTimes ? undefined : val.frequencyHours ?? undefined,
      explicitTimes,
      endAfterOccurrences: val.endAfterOccurrences ?? undefined,
      endAt: val.endAt ? new Date(val.endAt).toISOString() : undefined,
      notes: val.notes || undefined,
    };

    if (val.type === 'medication_dose') {
      Object.assign(body, {
        medicationId: val.medicationId || undefined,
        medicationEmbodimentId: val.medicationEmbodimentId || undefined,
        doseMg: val.doseMg ?? undefined,
        doseMl: val.doseMl ?? undefined,
        pillCount: val.pillCount ?? undefined,
      });
    } else {
      Object.assign(body, {
        bodyLocation: val.bodyLocation || undefined,
        side: val.side as any,
        dressingType: val.dressingType || undefined,
      });
    }

    this.api.post<InterventionSchedule, CreateScheduleDto>(`/patients/${val.patientId}/schedules`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.backOut();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not create schedule.'));
      },
    });
  }

  cancel() {
    this.backOut();
  }

  private backOut() {
    if (this.prefillConditionId) {
      this.router.navigate(['/conditions', this.prefillConditionId]);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
