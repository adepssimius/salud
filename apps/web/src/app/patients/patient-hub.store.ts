import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { AdverseReaction, Episode, Patient } from '@salud/shared/types';

/**
 * State shared by the patient hub shell and its tabs.
 *
 * Provided on the `patients/:id` route rather than in root, so one instance lives per hub visit and
 * is torn down on the way out. That is the point: without it every tab would issue its own
 * `GET /patients/:id` and the header would blank and refill on each tab switch. It is the first
 * route-scoped provider in the app; five children sharing one patient is what justifies it.
 */
@Injectable()
export class PatientHubStore {
  private readonly api = inject(ApiClientService);

  readonly patientId = signal<string>('');
  readonly patient = signal<Patient | null>(null);
  readonly reactions = signal<AdverseReaction[]>([]);
  readonly activeEpisodes = signal<Episode[]>([]);
  readonly error = signal<string | null>(null);

  /** Header material: only `danger` reactions earn a pill next to the patient's name (F-7.3). */
  readonly dangerReactions = computed(() => this.reactions().filter((r) => r.severity === 'danger'));

  load(patientId: string) {
    this.patientId.set(patientId);
    this.loadPatient();
    this.loadReactions();
    this.loadActiveEpisodes();
  }

  loadPatient() {
    this.api.get<Patient>(`/patients/${this.patientId()}`).subscribe({
      next: (res) => {
        this.patient.set(res);
        this.error.set(null);
      },
      // A patient that can't be read is the whole hub failing, not one tab — say so here rather
      // than letting every tab render its own empty state.
      error: (err) => this.error.set(errorText(err, 'Could not load this patient.')),
    });
  }

  loadReactions() {
    this.api.get<AdverseReaction[]>(`/patients/${this.patientId()}/reactions`).subscribe({
      next: (res) => this.reactions.set(res),
      error: () => this.reactions.set([]),
    });
  }

  loadActiveEpisodes() {
    this.api
      .get<Episode[]>(`/patients/${this.patientId()}/episodes`, { status: 'active' })
      .subscribe({
        next: (res) => this.activeEpisodes.set(res),
        error: () => this.activeEpisodes.set([]),
      });
  }
}
