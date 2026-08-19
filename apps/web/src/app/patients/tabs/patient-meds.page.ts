import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  AdverseReaction,
  InterventionSchedule,
  Medication,
  MedicationEmbodiment,
} from '@salud/shared/types';
import { concentrationText } from '../../core/concentration-display';
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
            <span class="reaction">
              <span class="reaction-head">
                <span
                  class="pill"
                  [class.pill-danger]="r.severity === 'danger'"
                  [class.pill-neutral]="r.severity !== 'danger'"
                  >{{ r.severity }}</span
                >
                <!-- The caregiver's own sentence, rendered as they typed it. -->
                <span class="description">{{ r.description }}</span>
              </span>
              <span class="muted small reaction-meta">
                <span>{{ describeReactionScope(r) }}</span>
                <span aria-hidden="true">·</span>
                <!-- Never an epoch-zero date on a clinical record: an unknown date says so
                     (frontend.md -> Reactions -> List row). -->
                <span>{{
                  r.occurredAt ? (r.occurredAt * 1000 | date: 'mediumDate') : 'Date unknown'
                }}</span>
                <ng-container *ngIf="recordedBy(r) as who">
                  <span aria-hidden="true">·</span>
                  <span>recorded by {{ who }}</span>
                </ng-container>
              </span>
            </span>
            <button type="button" class="tiny" (click)="deleteReaction(r)">Remove</button>
          </li>
        </ul>
        <!-- There is no PATCH for a reaction (ISSUES.md #30), and a caregiver who spots a typo
             needs to be told what to do about it rather than hunting for an edit affordance that
             does not exist. -->
        <p class="muted small correction-note" *ngIf="store.reactions().length">
          Reactions can't be edited. To correct one, remove it and record it again.
        </p>
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
      .reaction {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
      }
      .reaction-head {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
      }
      .description {
        font-weight: 700;
      }
      /* Scope, date and attribution wrap as a group on a phone rather than forcing the row wide. */
      .reaction-meta {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        flex-wrap: wrap;
      }
      .correction-note {
        margin: 0.6rem 0 0;
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
  /** `embodimentId` -> "acetaminophen — 160 mg/5 mL suspension (Children's Tylenol)". */
  private embodimentLabels = signal<Record<string, string>>({});
  private scopeNamesRequested = false;

  constructor() {
    // The hub store fetches reactions over HTTP and the shell renders this tab straight after
    // kicking that off, so the list is still empty when ngOnInit runs. Reading it there resolved
    // nothing and left every medication-scoped row saying "a medication" for the life of the page;
    // waiting for the signal instead resolves them the moment the reactions land.
    effect(() => {
      const reactions = this.store.reactions();
      if (!reactions.length || this.scopeNamesRequested) return;
      this.scopeNamesRequested = true;
      this.loadScopeNames(reactions);
    });
  }

  get patientId() {
    return this.store.patientId();
  }

  ngOnInit(): void {
    this.loadSchedules();
  }

  private loadSchedules() {
    this.api.get<InterventionSchedule[]>(`/patients/${this.patientId}/schedules`).subscribe({
      next: (res) => this.schedules.set(res),
      error: (err) => this.schedulesError.set(errorText(err, 'Could not load schedules.')),
    });
  }

  /** One catalog fetch resolves every medication-scoped reaction's name; a lookup per row was N+1. */
  private loadScopeNames(reactions: AdverseReaction[]) {
    const needsEmbodiments = reactions.some((r) => r.scopeType === 'embodiment');
    this.api.get<Medication[]>('/medications').subscribe({
      next: (meds) => {
        this.medicationNames.set(Object.fromEntries(meds.map((m) => [m.id, m.name])));
        if (needsEmbodiments) this.loadEmbodimentLabels(meds);
      },
      error: () => this.medicationNames.set({}),
    });
  }

  /**
   * An embodiment-scoped reaction stores only `embodimentId`, and no endpoint resolves one on its
   * own — so the forms are gathered per medication and indexed by id. Fanned out only when a row
   * actually needs it: a household catalog is a handful of medications, but this is still one
   * request each, and most patients have no embodiment-scoped reaction at all. A medication whose
   * forms fail to load drops out rather than failing the whole batch; its row falls back to the
   * generic wording instead of the card losing every name it had already resolved.
   */
  private loadEmbodimentLabels(meds: Medication[]) {
    if (!meds.length) return;
    forkJoin(
      meds.map((m) =>
        this.api.get<MedicationEmbodiment[]>(`/medications/${m.id}/embodiments`).pipe(
          map((forms) => ({ med: m, forms })),
          catchError(() => of({ med: m, forms: [] as MedicationEmbodiment[] })),
        ),
      ),
    ).subscribe((results) => {
      const labels: Record<string, string> = {};
      for (const { med, forms } of results) {
        for (const f of forms) {
          // A label is usually already the strength as printed ("160 mg/5 mL suspension"), in which
          // case prefixing the derived concentration says the same thing twice. Append it only for
          // a bare label ("suspension") that would otherwise not say how strong the form is.
          const conc = f.label.includes('mg') ? null : concentrationText(f);
          labels[f.id] = `${med.name} — ${conc ? `${conc} ` : ''}${f.label}`;
        }
      }
      this.embodimentLabels.set(labels);
    });
  }

  describeReactionScope(r: AdverseReaction): string {
    if (r.scopeType === 'tag') return `tag: ${r.tag}`;
    if (r.scopeType === 'embodiment') {
      return (r.embodimentId && this.embodimentLabels()[r.embodimentId]) || 'a specific form';
    }
    return (r.medicationId && this.medicationNames()[r.medicationId]) || 'a medication';
  }

  /**
   * Attribution (P3) read off the care team the hub already loaded — no extra request, and no
   * second answer to who someone is. Null when the recorder has since left the care team, which
   * reads better as no attribution at all than as a raw user id.
   */
  recordedBy(r: AdverseReaction): string | null {
    const member = this.store.careTeam().find((m) => m.user.id === r.recordedByUserId);
    if (!member) return null;
    return member.user.displayName || member.user.email;
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
