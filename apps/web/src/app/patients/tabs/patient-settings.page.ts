import { Component, effect, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Patient, UpdateCodeStatusDto, UpdatePatientDto } from '@salud/shared/types';
import { ApiClientService } from '../../core/api-client.service';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../core/error-display';
import { timeAgo } from '../../core/relative-time';
import { RevisionHistoryComponent } from '../../core/revision-history.component';
import { PatientHubStore } from '../patient-hub.store';

/**
 * The deliberate acts: edit the record, set the code status, delete the patient.
 *
 * Behind a gear rather than being the hub's landing tab, because editing is something a caregiver
 * chooses to do, not the resting state of a patient page (frontend.md → Information architecture
 * v2). Reactions, conditions and the care team, which used to share this page, now live on the
 * tabs where they are acted on.
 */
@Component({
  selector: 'app-patient-settings-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RevisionHistoryComponent],
  template: `
    <div class="layout">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Patient details</h2>
            <p class="muted">View and edit patient info.</p>
          </div>
          <div class="header-actions">
            <button
              *ngIf="isOwner()"
              class="danger"
              type="button"
              (click)="deletePatient()"
              [disabled]="deleting()"
            >
              {{ deleting() ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>

        <div class="error" *ngIf="deleteError()">{{ deleteError() }}</div>

        <form [formGroup]="form" (ngSubmit)="savePatient()" novalidate>
          <div class="grid">
            <label class="field">
              <span>Full name</span>
              <input type="text" formControlName="fullName" />
            </label>
            <label class="field">
              <span>Date of birth</span>
              <input type="date" formControlName="dateOfBirth" />
            </label>
            <label class="field">
              <span>Sex at birth</span>
              <select formControlName="sexAtBirth">
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span>Notes</span>
            <textarea rows="3" formControlName="notes"></textarea>
          </label>

          <div class="actions">
            <button class="primary" type="submit" [disabled]="form.invalid || savingPatient()">
              {{ savingPatient() ? 'Saving…' : 'Save changes' }}
            </button>
            <span class="muted" *ngIf="saveMessage()">{{ saveMessage() }}</span>
          </div>
        </form>
        <app-revision-history entityType="patient" [entityId]="patientId"></app-revision-history>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Code status</h2>
            <p class="muted">Set deliberately; the age is always visible.</p>
          </div>
          <button class="secondary" type="button" (click)="startEditCodeStatus()" *ngIf="!editingCodeStatus()">
            {{ store.patient()?.codeStatus ? 'Update' : 'Set code status' }}
          </button>
        </div>
        <div *ngIf="!editingCodeStatus()">
          <p *ngIf="store.patient()?.codeStatus" class="code-status-value">{{ store.patient()?.codeStatus }}</p>
          <p *ngIf="!store.patient()?.codeStatus" class="muted">Not set.</p>
          <p class="muted small" *ngIf="store.patient()?.codeStatusSetAt">
            Set by {{ codeStatusSetByName() }} · {{ codeStatusAge() }}
          </p>
        </div>
        <div class="inline" *ngIf="editingCodeStatus()">
          <input type="text" [(ngModel)]="codeStatusDraft" name="codeStatusDraft" placeholder="e.g. Full code" />
          <button class="primary" type="button" [disabled]="!codeStatusDraft.trim() || savingCodeStatus()" (click)="saveCodeStatus()">
            {{ savingCodeStatus() ? 'Saving…' : 'Save' }}
          </button>
          <button class="secondary" type="button" (click)="editingCodeStatus.set(false)">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .card-header {
        align-items: center;
      }
      h2 {
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
      }
      form {
        margin-top: 0.5rem;
      }
      .actions {
        justify-content: flex-start;
        gap: 0.75rem;
        align-items: center;
      }
      .danger {
        padding: 0.55rem 0.9rem;
        border-radius: var(--radius-control);
        background: var(--danger-bg);
        border: 1px solid var(--danger-border);
        color: var(--danger-text);
        font-weight: 700;
        cursor: pointer;
      }
      .code-status-value {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0.25rem 0;
      }
      .inline {
        display: flex;
        gap: 0.5rem;
      }
    `,
  ],
})
export class PatientSettingsPage {
  protected readonly store = inject(PatientHubStore);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  savingPatient = signal(false);
  saveMessage = signal<string | null>(null);
  deleting = signal(false);
  deleteError = signal<string | null>(null);
  editingCodeStatus = signal(false);
  codeStatusDraft = '';
  savingCodeStatus = signal(false);

  form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required]],
    dateOfBirth: ['', [Validators.required]],
    sexAtBirth: this.fb.control<'female' | 'male'>('female', { nonNullable: true }),
    notes: [''],
  });

  private currentUserId = computed(() => this.auth.user()?.id ?? null);

  get patientId() {
    return this.store.patientId();
  }

  isOwner = computed(() => {
    const uid = this.currentUserId();
    const p = this.store.patient();
    return !!uid && !!p && p.ownedById === uid;
  });

  /**
   * Resolved out of the hub store's care team, not a fetch of this tab's own — the care team is
   * rendered on the Share tab, but attribution (P3) has to hold up wherever the code status is
   * read, so the hub loads it once for both.
   */
  codeStatusSetByName = computed(() => {
    const id = this.store.patient()?.codeStatusSetByUserId;
    if (!id) return '';
    const member = this.store.careTeam().find((m) => m.user.id === id);
    return member?.user.displayName || member?.user.email || 'someone';
  });

  codeStatusAge = computed(() => {
    const at = this.store.patient()?.codeStatusSetAt;
    return at ? timeAgo(at) : '';
  });

  constructor() {
    // The hub owns the fetch, so the patient may land before or after this tab is constructed.
    // An effect covers both without the page issuing a duplicate GET; `pristine` keeps a reload
    // from stamping over edits the caregiver has started typing.
    effect(() => {
      const p = this.store.patient();
      if (p && this.form.pristine) this.patchForm(p);
    });
  }

  private patchForm(p: Patient) {
    this.form.patchValue({
      fullName: p.fullName,
      dateOfBirth: p.dateOfBirth,
      sexAtBirth: p.sexAtBirth,
      notes: p.notes ?? '',
    });
  }

  savePatient() {
    if (!this.currentUserId() || this.form.invalid) return;
    this.savingPatient.set(true);
    this.saveMessage.set(null);
    const dto: UpdatePatientDto = { ...this.form.getRawValue() };
    this.api.patch<Patient, UpdatePatientDto>(`/patients/${this.patientId}`, dto).subscribe({
      next: (p) => {
        this.store.patient.set(p);
        this.form.markAsPristine();
        this.savingPatient.set(false);
        this.saveMessage.set('Saved');
      },
      error: (err) => {
        this.savingPatient.set(false);
        this.saveMessage.set(errorText(err, 'Could not save.'));
      },
    });
  }

  startEditCodeStatus() {
    this.codeStatusDraft = this.store.patient()?.codeStatus ?? '';
    this.editingCodeStatus.set(true);
  }

  saveCodeStatus() {
    const codeStatus = this.codeStatusDraft.trim();
    if (!codeStatus) return;
    this.savingCodeStatus.set(true);
    this.api
      .patch<Patient, UpdateCodeStatusDto>(`/patients/${this.patientId}/code-status`, { codeStatus })
      .subscribe({
        next: (p) => {
          this.store.patient.set(p);
          this.savingCodeStatus.set(false);
          this.editingCodeStatus.set(false);
        },
        error: (err) => {
          this.savingCodeStatus.set(false);
          this.saveMessage.set(errorText(err, 'Could not save the code status.'));
        },
      });
  }

  deletePatient() {
    if (!this.isOwner()) return;
    const name = this.store.patient()?.fullName ?? 'this patient';
    if (!window.confirm(`Delete ${name}? This removes every observation, dose and document.`)) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api.delete<{ deleted: boolean }>(`/patients/${this.patientId}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.router.navigate(['/patients']);
      },
      error: (err) => {
        this.deleting.set(false);
        this.deleteError.set(errorText(err, 'Could not delete this patient.'));
      },
    });
  }
}
