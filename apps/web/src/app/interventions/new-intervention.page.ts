import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { CreateInterventionDto, InterventionType, Patient } from '@salud/shared/types';

@Component({
  selector: 'app-new-intervention-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <h1>Log Intervention</h1>
      <p class="muted">Record a medication dose or dressing change.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Patient</span>
          <select formControlName="patientId">
            <option value="" disabled>Select a patient</option>
            <option *ngFor="let p of patients()" [value]="p.id">
              {{ p.fullName }}
              <span *ngIf="p.myRole"> ({{ p.myRole }})</span>
            </option>
          </select>
        </label>

        <div class="grid">
          <label class="field">
            <span>Performed at</span>
            <input type="datetime-local" formControlName="performedAt" />
          </label>

          <label class="field">
            <span>Type</span>
            <select formControlName="type">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
        </div>

        <div class="grid">
          <label class="field">
            <span>Episode tags (comma separated)</span>
            <input type="text" formControlName="episodeIdsText" placeholder="e.g. ear-infection,fever" />
          </label>
          <label class="field">
            <span>Resolves episodes (comma separated)</span>
            <input type="text" formControlName="resolvesEpisodeIdsText" placeholder="must be subset of tags" />
          </label>
        </div>

        <ng-container *ngIf="isMedication()">
          <div class="grid">
            <label class="field">
              <span>Medication ID</span>
              <input type="text" formControlName="medicationId" />
            </label>
            <label class="field">
              <span>Embodiment ID (optional)</span>
              <input type="text" formControlName="medicationEmbodimentId" />
            </label>
          </div>
          <div class="grid">
            <label class="field">
              <span>Dose source</span>
              <select formControlName="doseSource">
                <option value="weight_based">Weight based</option>
                <option value="age_based">Age based</option>
                <option value="override">Override</option>
              </select>
            </label>
            <label class="field">
              <span>Amount (mg)</span>
              <input type="number" step="0.01" formControlName="amountMg" />
            </label>
            <label class="field">
              <span>Amount (mL)</span>
              <input type="number" step="0.01" formControlName="amountMl" />
            </label>
            <label class="field">
              <span>Pill count</span>
              <input type="number" step="0.5" formControlName="pillCount" />
            </label>
          </div>
          <div class="grid">
            <label class="field">
              <span>Weight used (kg)</span>
              <input type="number" step="0.01" formControlName="weightKgUsed" />
            </label>
            <label class="field">
              <span>Age used (months)</span>
              <input type="number" step="1" formControlName="ageMonthsUsed" />
            </label>
            <label class="field">
              <span>Guideline ID (optional)</span>
              <input type="text" formControlName="guidelineId" />
            </label>
            <label class="field">
              <span>Schedule ID (optional)</span>
              <input type="text" formControlName="interventionScheduleId" />
            </label>
          </div>
        </ng-container>

        <ng-container *ngIf="isDressingChange()">
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

        <label class="field">
          <span>Notes</span>
          <textarea rows="3" formControlName="notes"></textarea>
        </label>

        <div class="actions">
          <button class="secondary" type="button" (click)="cancel()">Cancel</button>
          <button class="primary" type="submit" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Save intervention' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
        <p class="muted" *ngIf="success()">Saved.</p>
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
      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
      }
      input,
      select,
      textarea {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      textarea {
        resize: vertical;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-top: 0.5rem;
      }
      .primary,
      .secondary {
        padding: 0.65rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
        border: none;
      }
      .primary {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #e2e8f0;
      }
      .error {
        color: #fca5a5;
      }
    `,
  ],
})
export class NewInterventionPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  patients = signal<Patient[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  form = this.fb.nonNullable.group({
    patientId: ['', Validators.required],
    performedAt: [this.defaultDateTime(), Validators.required],
    type: this.fb.control<InterventionType>('medication_dose', { nonNullable: true }),
    episodeIdsText: [''],
    resolvesEpisodeIdsText: [''],
    medicationId: [''],
    medicationEmbodimentId: [''],
    doseSource: ['override'],
    amountMg: [null as number | null],
    amountMl: [null as number | null],
    pillCount: [null as number | null],
    weightKgUsed: [null as number | null],
    ageMonthsUsed: [null as number | null],
    guidelineId: [''],
    interventionScheduleId: [''],
    bodyLocation: [''],
    side: ['n/a'],
    dressingType: [''],
    notes: [''],
  });

  ngOnInit(): void {
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
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    return localISOTime;
  }

  isMedication = computed(() => this.form.controls.type.value === 'medication_dose');
  isDressingChange = computed(() => this.form.controls.type.value === 'dressing_change');

  private loadPatients() {
    const user = this.auth.user();
    if (!user) return;
    this.api.get<Patient[]>(`/users/${user.id}/patients`).subscribe({
      next: (res) => {
        this.patients.set(res);
        if (res.length && !this.form.controls.patientId.value) {
          this.form.controls.patientId.setValue(res[0].id);
        }
      },
      error: () => {
        this.error.set('Unable to load patients.');
      },
    });
  }

  private parseList(val: string | null): string[] | undefined {
    if (!val) return undefined;
    const parts = val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length);
    return parts.length ? parts : undefined;
  }

  submit() {
    if (this.form.invalid || this.saving()) return;
    const user = this.auth.user();
    if (!user) {
      this.error.set('You must be signed in.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.success.set(false);

    const val = this.form.getRawValue();
    const body: CreateInterventionDto = {
      performedAt: new Date(val.performedAt).toISOString(),
      type: val.type,
      episodeIds: this.parseList(val.episodeIdsText),
      resolvesEpisodeIds: this.parseList(val.resolvesEpisodeIdsText),
      notes: val.notes || undefined,
    };

    if (val.type === 'medication_dose') {
      Object.assign(body, {
        medicationId: val.medicationId || undefined,
        medicationEmbodimentId: val.medicationEmbodimentId || undefined,
        doseSource: val.doseSource as any,
        amountMg: val.amountMg ?? undefined,
        amountMl: val.amountMl ?? undefined,
        pillCount: val.pillCount ?? undefined,
        weightKgUsed: val.weightKgUsed ?? undefined,
        ageMonthsUsed: val.ageMonthsUsed ?? undefined,
        guidelineId: val.guidelineId || undefined,
        interventionScheduleId: val.interventionScheduleId || undefined,
      });
    } else {
      Object.assign(body, {
        bodyLocation: val.bodyLocation || undefined,
        side: val.side as any,
        dressingType: val.dressingType || undefined,
        interventionScheduleId: val.interventionScheduleId || undefined,
      });
    }

    this.api.post(`/patients/${val.patientId}/interventions`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(true);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.message || 'Could not save intervention.');
      },
    });
  }

  cancel() {
    this.router.navigate(['/dashboard']);
  }
}
