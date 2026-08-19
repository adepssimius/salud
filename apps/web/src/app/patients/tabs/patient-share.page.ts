import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CareTeamMember, CareTeamRole, Patient, UpdatePatientDto } from '@salud/shared/types';
import { ApiClientService } from '../../core/api-client.service';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../core/error-display';
import { PatientHubStore } from '../patient-hub.store';

interface UserSearchResult {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Who can see this patient, and how their record leaves the household.
 *
 * The care team and the ER Brief share a tab because they are the same question asked twice — one
 * is standing access for caregivers, the other a one-off handoff to a clinician.
 */
@Component({
  selector: 'app-patient-share-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="layout">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>ER Brief</h2>
            <p class="muted">One page for a triage desk: allergies, meds, conditions, recent events.</p>
          </div>
          <button class="secondary" type="button" (click)="goToErBrief()">Open ER Brief</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Caregivers</h2>
            <p class="muted">Manage care team access and relationships.</p>
          </div>
          <button class="secondary" type="button" (click)="openAddCaregiver()">Add caregiver</button>
        </div>

        <div *ngIf="store.careTeamLoading()">Loading caregivers…</div>
        <div *ngIf="store.careTeamError()" class="error">{{ store.careTeamError() }}</div>

        <table *ngIf="!store.careTeamLoading() && store.careTeam().length" class="care-table">
          <thead>
            <tr>
              <th>Caregiver</th>
              <th>Relationship</th>
              <th>Owner</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let member of store.careTeam()">
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
                <span class="pill pill-success" *ngIf="member.user.id === store.patient()?.ownedById">Owner</span>
                <button
                  type="button"
                  class="tiny"
                  *ngIf="member.user.id !== store.patient()?.ownedById"
                  (click)="makeOwner(member)"
                >
                  Make owner
                </button>
              </td>
              <td class="actions-cell">
                <button
                  type="button"
                  class="icon-button"
                  [disabled]="member.user.id === store.patient()?.ownedById"
                  (click)="removeCaregiver(member)"
                >
                  🗑️
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="muted" *ngIf="!store.careTeamLoading() && !store.careTeam().length">No caregivers yet.</p>
      </div>
    </div>

    <button
      type="button"
      class="modal-backdrop"
      *ngIf="addModalOpen()"
      aria-label="Close dialog"
      (click)="closeAddModal()"
    ></button>
    <div class="modal" *ngIf="addModalOpen()" role="dialog" aria-modal="true">
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
          <li *ngFor="let u of searchResults" [class.selected]="u.id === selectedUserId">
            <button
              type="button"
              class="result-button"
              [attr.aria-pressed]="u.id === selectedUserId"
              (click)="selectUser(u.id)"
            >
              <div class="name">{{ u.displayName || u.email }}</div>
              <div class="muted small">{{ u.email }}</div>
            </button>
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
      .card-header {
        align-items: center;
      }
      h2 {
        margin: 0;
      }
      .care-table {
        width: 100%;
        border-collapse: collapse;
      }
      .care-table th,
      .care-table td {
        text-align: left;
        padding: 0.6rem;
        border-bottom: 1px solid var(--border);
      }
      .name {
        font-weight: 700;
      }
      .actions-cell {
        text-align: right;
      }
      .icon-button {
        border: none;
        background: transparent;
        color: var(--text);
        cursor: pointer;
      }
      .tiny {
        padding: 0.35rem 0.6rem;
        border: none;
        border-radius: var(--radius-control);
        background: var(--neutral-bg);
        color: var(--text);
        font-weight: 700;
        cursor: pointer;
      }
      /* A button rather than a div so dismissing the modal is reachable without a mouse. */
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        border: none;
        padding: 0;
        cursor: pointer;
      }
      .modal {
        position: fixed;
        top: 15%;
        left: 50%;
        transform: translateX(-50%);
        width: min(520px, 92vw);
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-card);
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
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
      }
      .result-button {
        width: 100%;
        padding: 0.65rem;
        text-align: left;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .search-results li.selected {
        border-color: var(--accent-border);
        background: var(--accent-bg);
      }
    `,
  ],
})
export class PatientSharePage {
  protected readonly store = inject(PatientHubStore);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  roles: CareTeamRole[] = ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'];

  addModalOpen = signal(false);
  savingCaregiver = signal(false);
  searchEmail = '';
  searchResults: UserSearchResult[] = [];
  selectedUserId: string | null = null;
  newCaregiverRole: CareTeamRole = 'other';
  searchError: string | null = null;

  private currentUserId = computed(() => this.auth.user()?.id ?? null);

  get patientId() {
    return this.store.patientId();
  }

  goToErBrief() {
    this.router.navigate(['/patients', this.patientId, 'er-brief']);
  }

  changeRole(member: CareTeamMember, role: CareTeamRole) {
    if (!this.currentUserId()) return;
    this.api
      .post<CareTeamMember, { userId: string; role: CareTeamRole }>(
        `/patients/${this.patientId}/care-team`,
        { userId: member.user.id, role },
      )
      .subscribe({
        next: (res) => {
          this.store.careTeam.set(
            this.store.careTeam().map((m) => (m.user.id === member.user.id ? { ...m, role: res.role } : m)),
          );
        },
        error: (err) => this.store.careTeamError.set(errorText(err, 'Could not update relationship.')),
      });
  }

  makeOwner(member: CareTeamMember) {
    if (!this.currentUserId()) return;
    this.api
      .patch<Patient, UpdatePatientDto>(`/patients/${this.patientId}`, { ownedById: member.user.id })
      .subscribe({
        next: (p) => this.store.patient.set(p),
        error: (err) => {
          // The default USER_NOT_FOUND sentence is written for adding a caregiver by a stale search
          // result; transferring ownership needs its own wording (app-spec/frontend.md → "Errors &
          // failure messages").
          this.store.careTeamError.set(
            errorText(err, 'Could not update owner.', {
              USER_NOT_FOUND: 'That caregiver is no longer on this care team. Refresh the page and try again.',
            }),
          );
        },
      });
  }

  removeCaregiver(member: CareTeamMember) {
    if (!this.currentUserId()) return;
    if (member.user.id === this.store.patient()?.ownedById) return;
    this.api.delete<{ deleted: boolean }>(`/patients/${this.patientId}/care-team/${member.user.id}`).subscribe({
      next: () => this.store.careTeam.set(this.store.careTeam().filter((m) => m.user.id !== member.user.id)),
      error: (err) => this.store.careTeamError.set(errorText(err, 'Could not remove caregiver.')),
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
        if (users.length) this.selectedUserId = users[0].id;
      },
      error: (err) => (this.searchError = errorText(err, 'Unable to search right now.')),
    });
  }

  selectUser(id: string) {
    this.selectedUserId = id;
  }

  addCaregiver() {
    if (!this.currentUserId() || !this.selectedUserId) return;
    this.savingCaregiver.set(true);
    this.api
      .post<CareTeamMember, { userId: string; role: CareTeamRole }>(`/patients/${this.patientId}/care-team`, {
        userId: this.selectedUserId,
        role: this.newCaregiverRole,
      })
      .subscribe({
        next: (member) => {
          this.store.careTeam.set([...this.store.careTeam(), member]);
          this.savingCaregiver.set(false);
          this.closeAddModal();
        },
        error: (err) => {
          this.store.careTeamError.set(errorText(err, 'Could not add caregiver.'));
          this.savingCaregiver.set(false);
        },
      });
  }
}
