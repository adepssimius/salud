import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import {
  CareTeamMember,
  CareTeamRole,
  Patient,
  SexAtBirth,
  UpdatePatientDto,
  UserProfile,
} from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

interface UserSearchResult {
  id: string;
  email: string;
  displayName: string;
}

@Component({
  selector: 'app-patient-detail-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="layout">
      <div class="card">
        <div class="card-header">
          <div>
            <h1>Patient Details</h1>
            <p class="muted">View and edit patient info.</p>
          </div>
          <div class="header-actions">
            <button class="secondary" type="button" (click)="backToProfile()">Back</button>
            <button class="danger" type="button" (click)="deletePatient()" [disabled]="deleting()">
              {{ deleting() ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>

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
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Caregivers</h2>
            <p class="muted">Manage care team access and relationships.</p>
          </div>
          <button class="secondary" type="button" (click)="openAddCaregiver()">Add caregiver</button>
        </div>

        <div *ngIf="careTeamLoading()">Loading caregivers…</div>
        <div *ngIf="careTeamError()" class="error">{{ careTeamError() }}</div>

        <table *ngIf="!careTeamLoading() && careTeam().length" class="care-table">
          <thead>
            <tr>
              <th>Caregiver</th>
              <th>Relationship</th>
              <th>Owner</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let member of careTeam()">
              <td>
                <div class="name">{{ member.user.displayName || member.user.email }}</div>
                <div class="muted small">{{ member.user.email }}</div>
              </td>
              <td>
                <select
                  name="role-{{ member.user.id }}"
                  [(ngModel)]="member.role"
                  (ngModelChange)="changeRole(member, $event)"
                >
                  <option *ngFor="let role of roles" [value]="role">{{ role }}</option>
                </select>
              </td>
              <td>
                <span class="pill owner" *ngIf="member.user.id === patient()?.ownedById">Owner</span>
                <button
                  type="button"
                  class="tiny"
                  *ngIf="member.user.id !== patient()?.ownedById"
                  (click)="makeOwner(member)"
                >
                  Make owner
                </button>
              </td>
              <td class="actions-cell">
                <button
                  type="button"
                  class="icon-button"
                  [disabled]="member.user.id === patient()?.ownedById"
                  (click)="removeCaregiver(member)"
                >
                  🗑️
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="muted" *ngIf="!careTeamLoading() && !careTeam().length">No caregivers yet.</p>
      </div>
    </div>

    <div class="modal-backdrop" *ngIf="addModalOpen()" (click)="closeAddModal()"></div>
    <div class="modal" *ngIf="addModalOpen()">
      <div class="modal-header">
        <h3>Add caregiver</h3>
        <button class="icon-button" (click)="closeAddModal()">✕</button>
      </div>
      <div class="modal-body">
        <label class="field">
          <span>Search by email</span>
          <div class="inline">
            <input type="email" [(ngModel)]="searchEmail" name="searchEmail" />
            <button class="secondary" type="button" (click)="searchUsers()">Search</button>
          </div>
        </label>
        <div *ngIf="searchError" class="error">{{ searchError }}</div>
        <ul class="search-results" *ngIf="searchResults.length">
          <li
            *ngFor="let u of searchResults"
            [class.selected]="u.id === selectedUserId"
            (click)="selectUser(u.id)"
          >
            <div class="name">{{ u.displayName || u.email }}</div>
            <div class="muted small">{{ u.email }}</div>
          </li>
        </ul>

        <label class="field">
          <span>Relationship</span>
          <select [(ngModel)]="newCaregiverRole" name="newCaregiverRole">
            <option *ngFor="let role of roles" [value]="role">{{ role }}</option>
          </select>
        </label>
      </div>
      <div class="modal-footer">
        <button class="secondary" type="button" (click)="closeAddModal()">Cancel</button>
        <button class="primary" type="button" [disabled]="!selectedUserId || savingCaregiver()" (click)="addCaregiver()">
          {{ savingCaregiver() ? 'Adding…' : 'Add caregiver' }}
        </button>
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
      .card {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .header-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      h1,
      h2 {
        margin: 0;
      }
      .muted {
        color: #cbd5e1;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 0.5rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
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
        gap: 0.75rem;
        align-items: center;
      }
      .primary,
      .secondary,
      .danger,
      .tiny {
        border: none;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .primary {
        padding: 0.65rem 1rem;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .secondary {
        padding: 0.55rem 0.9rem;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #e2e8f0;
      }
      .danger {
        padding: 0.55rem 0.9rem;
        background: rgba(248, 113, 113, 0.12);
        border: 1px solid rgba(248, 113, 113, 0.6);
        color: #fecdd3;
      }
      .tiny {
        padding: 0.35rem 0.6rem;
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .care-table {
        width: 100%;
        border-collapse: collapse;
      }
      .care-table th,
      .care-table td {
        text-align: left;
        padding: 0.6rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .name {
        font-weight: 700;
      }
      .small {
        font-size: 0.9rem;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: rgba(34, 211, 238, 0.15);
        border: 1px solid rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
        font-weight: 700;
        text-transform: capitalize;
      }
      .pill.owner {
        background: rgba(34, 197, 94, 0.2);
        border-color: rgba(34, 197, 94, 0.5);
        color: #bbf7d0;
      }
      .actions-cell {
        text-align: right;
      }
      .icon-button {
        border: none;
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
      }
      .error {
        color: #fca5a5;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
      }
      .modal {
        position: fixed;
        top: 15%;
        left: 50%;
        transform: translateX(-50%);
        width: min(520px, 92vw);
        background: #0b1224;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 1rem;
        z-index: 50;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
      }
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }
      .modal-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .inline {
        display: flex;
        gap: 0.5rem;
      }
      .search-results {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .search-results li {
        padding: 0.65rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
      }
      .search-results li.selected {
        border-color: rgba(14, 165, 233, 0.7);
        background: rgba(14, 165, 233, 0.1);
      }
    `,
  ],
})
export class PatientDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  roles: CareTeamRole[] = ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'];

  patientId = '';
  patient = signal<Patient | null>(null);
  savingPatient = signal(false);
  saveMessage = signal<string | null>(null);
  deleting = signal(false);

  careTeam = signal<CareTeamMember[]>([]);
  careTeamLoading = signal(false);
  careTeamError = signal<string | null>(null);

  addModalOpen = signal(false);
  searchEmail = '';
  searchResults: UserSearchResult[] = [];
  selectedUserId: string | null = null;
  newCaregiverRole: CareTeamRole = 'other';
  savingCaregiver = signal(false);
  searchError: string | null = null;

  form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(1)]],
    dateOfBirth: ['', [Validators.required]],
    sexAtBirth: this.fb.control<SexAtBirth>('female', { nonNullable: true }),
    notes: [''],
  });

  currentUserId = computed(() => this.auth.user()?.id ?? null);

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.patientId) {
      this.router.navigateByUrl('/profile?tab=patients');
      return;
    }
    if (!this.auth.user() && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadData(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadData();
    }
  }

  private loadData() {
    if (!this.currentUserId()) return;
    this.loadPatient();
    this.loadCareTeam();
  }

  private loadPatient() {
    if (!this.currentUserId()) return;
    this.api.get<Patient>(`/users/${this.currentUserId()}/patients/${this.patientId}`).subscribe({
      next: (p) => {
        this.patient.set(p);
        this.form.patchValue({
          fullName: p.fullName,
          dateOfBirth: p.dateOfBirth,
          sexAtBirth: p.sexAtBirth,
          notes: p.notes ?? '',
        });
      },
      error: () => {
        this.router.navigateByUrl('/profile?tab=patients');
      },
    });
  }

  private loadCareTeam() {
    if (!this.currentUserId()) return;
    this.careTeamLoading.set(true);
    this.careTeamError.set(null);
    this.api
      .get<{ careTeam?: CareTeamMember[] } | CareTeamMember[]>(`/users/${this.currentUserId()}/patients/${this.patientId}/care-team`)
      .subscribe({
        next: (res) => {
          const list = Array.isArray(res) ? res : res.careTeam ?? [];
          this.careTeam.set(list);
          this.careTeamLoading.set(false);
        },
        error: () => {
          this.careTeamError.set('Unable to load caregivers right now.');
          this.careTeamLoading.set(false);
        },
      });
  }

  savePatient() {
    if (!this.currentUserId() || this.form.invalid) return;
    this.savingPatient.set(true);
    this.saveMessage.set(null);
    const dto: UpdatePatientDto = { ...this.form.getRawValue() };
    this.api.patch<Patient, UpdatePatientDto>(`/users/${this.currentUserId()}/patients/${this.patientId}`, dto).subscribe({
      next: (p) => {
        this.patient.set(p);
        this.savingPatient.set(false);
        this.saveMessage.set('Saved');
      },
      error: () => {
        this.savingPatient.set(false);
        this.saveMessage.set('Error saving');
      },
    });
  }

  changeRole(member: CareTeamMember, role: CareTeamRole) {
    if (!this.currentUserId()) return;
    this.api
      .post<CareTeamMember, { userId: string; role: CareTeamRole }>(
        `/users/${this.currentUserId()}/patients/${this.patientId}/care-team`,
        { userId: member.user.id, role },
      )
      .subscribe({
        next: (res) => {
          this.careTeam.set(
            this.careTeam().map((m) =>
              m.user.id === member.user.id ? { ...m, role: res.role } : m,
            ),
          );
        },
        error: () => {
          this.careTeamError.set('Could not update relationship.');
        },
      });
  }

  makeOwner(member: CareTeamMember) {
    if (!this.currentUserId()) return;
    this.api
      .patch<Patient, UpdatePatientDto>(`/users/${this.currentUserId()}/patients/${this.patientId}`, {
        ownedById: member.user.id,
      })
      .subscribe({
        next: (p) => {
          this.patient.set(p);
        },
        error: () => {
          this.careTeamError.set('Could not update owner.');
        },
      });
  }

  removeCaregiver(member: CareTeamMember) {
    if (!this.currentUserId()) return;
    if (member.user.id === this.patient()?.ownedById) return;
    this.api
      .delete<{ deleted: boolean }>(
        `/users/${this.currentUserId()}/patients/${this.patientId}/care-team/${member.user.id}`,
      )
      .subscribe({
        next: () => {
          this.careTeam.set(this.careTeam().filter((m) => m.user.id !== member.user.id));
        },
        error: () => {
          this.careTeamError.set('Could not remove caregiver.');
        },
      });
  }

  openAddCaregiver() {
    this.addModalOpen.set(true);
    this.searchResults = [];
    this.selectedUserId = null;
    this.newCaregiverRole = 'other';
    this.searchEmail = '';
    this.searchError = null;
  }

  closeAddModal() {
    this.addModalOpen.set(false);
  }

  searchUsers() {
    if (!this.searchEmail) return;
    this.searchError = null;
    this.api.get<UserSearchResult[]>(`/users/search`, { email: this.searchEmail }).subscribe({
      next: (users) => {
        this.searchResults = users;
        if (users.length) {
          this.selectedUserId = users[0].id;
        }
      },
      error: () => {
        this.searchError = 'Unable to search right now.';
      },
    });
  }

  selectUser(id: string) {
    this.selectedUserId = id;
  }

  addCaregiver() {
    if (!this.currentUserId() || !this.selectedUserId) return;
    this.savingCaregiver.set(true);
    this.api
      .post<CareTeamMember, { userId: string; role: CareTeamRole }>(
        `/users/${this.currentUserId()}/patients/${this.patientId}/care-team`,
        { userId: this.selectedUserId, role: this.newCaregiverRole },
      )
      .subscribe({
        next: (member) => {
          this.careTeam.set([...this.careTeam(), member]);
          this.savingCaregiver.set(false);
          this.closeAddModal();
        },
        error: () => {
          this.careTeamError.set('Could not add caregiver.');
          this.savingCaregiver.set(false);
        },
      });
  }

  backToProfile() {
    this.router.navigate(['/profile'], { queryParams: { tab: 'patients' } });
  }

  deletePatient() {
    if (!this.currentUserId() || this.deleting()) return;
    const confirmed = window.confirm('Delete this patient? This cannot be undone.');
    if (!confirmed) return;
    this.deleting.set(true);
    this.api.delete<{ deleted: boolean }>(`/users/${this.currentUserId()}/patients/${this.patientId}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.router.navigate(['/profile'], { queryParams: { tab: 'patients' } });
      },
      error: () => {
        this.deleting.set(false);
        this.careTeamError.set('Could not delete patient.');
      },
    });
  }
}
