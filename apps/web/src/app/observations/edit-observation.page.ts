import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CareTeamMember, Episode, Observation, Patient } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { correctionEpisodeState } from '../core/entry-correction';
import { NewObservationPage, ObservationCorrectionContext } from './new-observation.page';

/**
 * `/observations/:id/edit` — correcting an observation (frontend.md → "Correcting an entry").
 *
 * Loads the entry and what the form needs around it, then hands it to the *create* form in its
 * correction mode: one form, one set of entry mini-forms, so a correction can never drift from how
 * the entry was first logged. Everything about saving lives in that form.
 */
@Component({
  selector: 'app-edit-observation-page',
  standalone: true,
  imports: [CommonModule, NewObservationPage],
  template: `
    <div class="card" *ngIf="error() as message">
      <button type="button" class="link" (click)="back()">&larr; Back</button>
      <p class="error">{{ message }}</p>
    </div>
    <p class="muted" *ngIf="!error() && !context()">Loading…</p>
    <app-new-observation-page *ngIf="context() as ctx" [correction]="ctx"></app-new-observation-page>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .link {
        align-self: flex-start;
      }
    `,
  ],
})
export class EditObservationPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  observationId = this.route.snapshot.paramMap.get('id') ?? '';
  context = signal<ObservationCorrectionContext | null>(null);
  error = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.observationId) return;
    this.api.get<Observation>(`/observations/${this.observationId}`).subscribe({
      next: (obs) => this.loadContext(obs),
      // Same words as the detail page: a 404 here means the same thing it means there.
      error: (err) => this.error.set(errorText(err, 'Unable to load this observation.')),
    });
  }

  /**
   * The patient's name, the episode list and the recorder's name. All best-effort: none of them is
   * the record, and a failed lookup degrades to an unnamed episode or "Unknown caregiver" rather
   * than blocking a correction.
   */
  private loadContext(obs: Observation) {
    forkJoin({
      patient: this.api.get<Patient>(`/patients/${obs.patientId}`).pipe(catchError(() => of(null))),
      episodes: this.api.get<Episode[]>(`/patients/${obs.patientId}/episodes`).pipe(catchError(() => of([] as Episode[]))),
      careTeam: this.api
        .get<CareTeamMember[]>(`/patients/${obs.patientId}/care-team`)
        .pipe(catchError(() => of([] as CareTeamMember[]))),
    }).subscribe(({ patient, episodes, careTeam }) => {
      this.context.set({
        observation: obs,
        patientName: patient?.fullName ?? '',
        recordedByName: careTeam.find((m) => m.user.id === obs.recordedByUserId)?.user.displayName ?? null,
        episodes: correctionEpisodeState(obs, 'observation', episodes),
      });
    });
  }

  back() {
    this.router.navigate(['/observations', this.observationId]);
  }
}
