import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CareTeamMember, Episode, Intervention, InterventionSchedule, Patient } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { correctionEpisodeState } from '../core/entry-correction';
import { InterventionCorrectionContext, NewInterventionPage } from './new-intervention.page';

/**
 * `/interventions/:id/edit` — correcting a dose or a dressing change (frontend.md → "Correcting an
 * entry").
 *
 * Loads the entry and what the form needs around it, then hands it to the *create* form in its
 * correction mode — the same medication typeahead, embodiment picker, live dose check, banners and
 * danger interstitial a dose was logged with. Everything about saving lives in that form.
 */
@Component({
  selector: 'app-edit-intervention-page',
  standalone: true,
  imports: [CommonModule, NewInterventionPage],
  template: `
    <div class="card" *ngIf="error() as message">
      <button type="button" class="link" (click)="back()">&larr; Back</button>
      <p class="error">{{ message }}</p>
    </div>
    <p class="muted" *ngIf="!error() && !context()">Loading…</p>
    <app-new-intervention-page *ngIf="context() as ctx" [correction]="ctx"></app-new-intervention-page>
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
export class EditInterventionPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  interventionId = this.route.snapshot.paramMap.get('id') ?? '';
  context = signal<InterventionCorrectionContext | null>(null);
  error = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.interventionId) return;
    this.api.get<Intervention>(`/interventions/${this.interventionId}`).subscribe({
      next: (iv) => this.loadContext(iv),
      // Same words as the detail page: a 404 here means the same thing it means there.
      error: (err) => this.error.set(errorText(err, 'Unable to load this intervention.')),
    });
  }

  /**
   * The patient's name, the episode list, the recorder's name and the schedule's name. All
   * best-effort, as on the detail page: none of them is the record.
   */
  private loadContext(iv: Intervention) {
    const m: any = iv.metadata ?? {};
    const scheduleId: string | null = iv.scheduleId ?? m.interventionScheduleId ?? null;
    forkJoin({
      patient: this.api.get<Patient>(`/patients/${iv.patientId}`).pipe(catchError(() => of(null))),
      episodes: this.api.get<Episode[]>(`/patients/${iv.patientId}/episodes`).pipe(catchError(() => of([] as Episode[]))),
      careTeam: this.api
        .get<CareTeamMember[]>(`/patients/${iv.patientId}/care-team`)
        .pipe(catchError(() => of([] as CareTeamMember[]))),
      schedule: scheduleId
        ? this.api.get<InterventionSchedule>(`/schedules/${scheduleId}`).pipe(catchError(() => of(null)))
        : of(null),
    }).subscribe(({ patient, episodes, careTeam, schedule }) => {
      this.context.set({
        intervention: iv,
        patientName: patient?.fullName ?? '',
        recordedByName: careTeam.find((mem) => mem.user.id === iv.recordedByUserId)?.user.displayName ?? null,
        scheduleLabel: schedule?.label ?? null,
        episodes: correctionEpisodeState(iv, 'intervention', episodes),
      });
    });
  }

  back() {
    this.router.navigate(['/interventions', this.interventionId]);
  }
}
