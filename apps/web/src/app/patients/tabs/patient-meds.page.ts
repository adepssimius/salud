import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AdverseReaction, InterventionSchedule, Medication } from '@salud/shared/types';
import { ApiClientService } from '../../core/api-client.service';
import { errorText } from '../../core/error-display';
import { PatientHubStore } from '../patient-hub.store';

/**
 * Medication-facing state for one patient: standing schedules, and the adverse reactions that warn
 * at dose entry.
 *
 * Reactions live here rather than on the patient's edit form (where they used to sit) because that
 * is where they act — `reaction_warning` banners and the `reaction_danger` interstitial both fire
 * while a dose is being logged (frontend.md → Information architecture v2).
 */
@Component({
  selector: 'app-patient-meds-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="layout">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Schedules</h2>
            <p class="muted">Standing intent — "amoxicillin 400 mg every 8 h".</p>
          </div>
          <button class="secondary" type="button" (click)="goToNewSchedule()">New schedule</button>
        </div>
        <div class="error" *ngIf="schedulesError()">{{ schedulesError() }}</div>
        <ul class="row-list" *ngIf="schedules().length">
          <li *ngFor="let s of schedules()">
            <button type="button" class="row-button" (click)="goToSchedule(s.id)">
              <span class="name">{{ s.label }}</span>
              <span class="pill" [class.pill-success]="s.status === 'active'">{{ s.status }}</span>
            </button>
          </li>
        </ul>
        <p class="muted" *ngIf="!schedules().length && !schedulesError()">No schedules yet.</p>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Reactions</h2>
            <p class="muted">Allergies and adverse reactions. These warn you at dose entry.</p>
          </div>
          <button class="secondary" type="button" (click)="goToNewReaction()">Add reaction</button>
        </div>
        <div class="error" *ngIf="reactionsError()">{{ reactionsError() }}</div>
        <ul class="row-list" *ngIf="store.reactions().length">
          <li *ngFor="let r of store.reactions()">
            <span>
              <span class="pill" [class.pill-danger]="r.severity === 'danger'" [class.pill-neutral]="r.severity !== 'danger'">
                {{ r.severity }}
              </span>
              {{ r.description }}
              <span class="muted small"> — {{ describeReactionScope(r) }}</span>
              <span class="muted small">
                ·
                <ng-container *ngIf="r.occurredAt; else noDate">{{
                  r.occurredAt! * 1000 | date: 'mediumDate'
                }}</ng-container>
                <ng-template #noDate>Date unknown</ng-template>
              </span>
            </span>
            <button type="button" class="tiny" (click)="deleteReaction(r)">Remove</button>
          </li>
        </ul>
        <p class="muted" *ngIf="!store.reactions().length">No reactions recorded.</p>
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
      .row-list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .row-button {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.65rem 0.75rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .name {
        font-weight: 700;
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
      .pill {
        text-transform: capitalize;
      }
    `,
  ],
})
export class PatientMedsPage implements OnInit {
  protected readonly store = inject(PatientHubStore);
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);

  schedules = signal<InterventionSchedule[]>([]);
  schedulesError = signal<string | null>(null);
  reactionsError = signal<string | null>(null);
  private medicationNames = signal<Record<string, string>>({});

  get patientId() {
    return this.store.patientId();
  }

  ngOnInit(): void {
    this.loadSchedules();
    this.loadMedicationNames();
  }

  private loadSchedules() {
    this.api.get<InterventionSchedule[]>(`/patients/${this.patientId}/schedules`).subscribe({
      next: (res) => this.schedules.set(res),
      error: (err) => this.schedulesError.set(errorText(err, 'Could not load schedules.')),
    });
  }

  /** One catalog fetch resolves every medication-scoped reaction's name; a lookup per row was N+1. */
  private loadMedicationNames() {
    if (!this.store.reactions().length) return;
    this.api.get<Medication[]>('/medications').subscribe({
      next: (meds) => this.medicationNames.set(Object.fromEntries(meds.map((m) => [m.id, m.name]))),
      error: () => this.medicationNames.set({}),
    });
  }

  describeReactionScope(r: AdverseReaction): string {
    if (r.scopeType === 'tag') return `tag: ${r.tag}`;
    if (r.scopeType === 'medication' && r.medicationId) {
      return this.medicationNames()[r.medicationId] ?? 'a medication';
    }
    // Embodiment names would need a second lookup per row; the form it applies to is visible on
    // the medication page, and the description is what a caregiver scans this list for.
    return 'a specific form';
  }

  goToNewReaction() {
    this.router.navigate(['/patients', this.patientId, 'reactions', 'new']);
  }

  goToNewSchedule() {
    this.router.navigate(['/schedules/new'], { queryParams: { patientId: this.patientId } });
  }

  goToSchedule(id: string) {
    this.router.navigate(['/schedules', id]);
  }

  deleteReaction(r: AdverseReaction) {
    // A mis-scoped reaction fires a full-screen interstitial on every future dose, so removing one
    // is a real action -- confirm, matching the care-team and patient delete convention.
    if (!window.confirm(`Remove the reaction "${r.description}"?`)) return;
    this.reactionsError.set(null);
    this.api.delete<{ deleted: boolean }>(`/patients/${this.patientId}/reactions/${r.id}`).subscribe({
      // Through the store, so the hub header's danger pills drop the reaction at the same moment
      // this list does.
      next: () => this.store.reactions.set(this.store.reactions().filter((x) => x.id !== r.id)),
      error: (err) => this.reactionsError.set(errorText(err, 'Could not remove the reaction.')),
    });
  }
}
