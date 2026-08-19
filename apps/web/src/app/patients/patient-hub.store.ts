import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { PatientNameStore } from '../core/patient-name.store';
import {
  AdverseReaction,
  CareTeamMember,
  Episode,
  Patient,
} from '@salud/shared/types';

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
  private readonly names = inject(PatientNameStore);

  readonly patientId = signal<string>('');
  readonly patient = signal<Patient | null>(null);
  readonly reactions = signal<AdverseReaction[]>([]);
  readonly activeEpisodes = signal<Episode[]>([]);
  readonly careTeam = signal<CareTeamMember[]>([]);
  readonly careTeamLoading = signal(false);
  readonly careTeamError = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** Header material: only `danger` reactions earn a pill next to the patient's name (F-7.3). */
  readonly dangerReactions = computed(() =>
    this.reactions().filter((r) => r.severity === 'danger')
  );

  load(patientId: string) {
    this.patientId.set(patientId);
    this.loadPatient();
    this.loadReactions();
    this.loadActiveEpisodes();
    // Loaded at the hub rather than by the Share tab that renders it: the Settings tab resolves the
    // name behind "code status set by ..." out of the same list, and attribution (P3) shouldn't
    // depend on which tab happens to be open.
    this.loadCareTeam();
  }

  loadPatient() {
    this.api.get<Patient>(`/patients/${this.patientId()}`).subscribe({
      next: (res) => {
        this.patient.set(res);
        // Hands the tab title its name off this request instead of a second one, and refreshes it
        // after a rename (core/patient-name.store.ts).
        this.names.remember(res);
        this.error.set(null);
      },
      // A patient that can't be read is the whole hub failing, not one tab — say so here rather
      // than letting every tab render its own empty state.
      error: (err) =>
        this.error.set(errorText(err, 'Could not load this patient.')),
    });
  }

  loadReactions() {
    this.api
      .get<AdverseReaction[]>(`/patients/${this.patientId()}/reactions`)
      .subscribe({
        next: (res) => this.reactions.set(res),
        error: () => this.reactions.set([]),
      });
  }

  loadCareTeam() {
    this.careTeamLoading.set(true);
    this.careTeamError.set(null);
    this.api
      .get<{ careTeam?: CareTeamMember[] } | CareTeamMember[]>(
        `/patients/${this.patientId()}/care-team`
      )
      .subscribe({
        next: (res) => {
          this.careTeam.set(Array.isArray(res) ? res : res.careTeam ?? []);
          this.careTeamLoading.set(false);
        },
        error: (err) => {
          this.careTeamError.set(
            errorText(err, 'Could not load the care team.')
          );
          this.careTeamLoading.set(false);
        },
      });
  }

  loadActiveEpisodes() {
    this.api
      .get<Episode[]>(`/patients/${this.patientId()}/episodes`, {
        status: 'active',
      })
      .subscribe({
        next: (res) => this.activeEpisodes.set(res),
        error: () => this.activeEpisodes.set([]),
      });
  }
}
