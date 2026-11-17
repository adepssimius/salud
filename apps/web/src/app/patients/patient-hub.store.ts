import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
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
 * Provided on the `patients/:id` route rather than in root, so the hub's tabs share one
 * `GET /patients/:id` instead of each issuing its own, and the header does not blank and refill on
 * each tab switch. Note what a route provider is *not*: Angular builds its injector once per route
 * config, so this one instance outlives any single hub visit, and the shell is reused when only
 * `:id` changes (a sidebar click from one patient's hub to another's). It therefore holds whichever
 * patient it was last loaded for, and `load()` is what makes that the current one — see there.
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

  /** Requests in flight for the current patient; cancelled the moment the patient changes. */
  private inflight = new Subscription();

  /**
   * Make `patientId` the hub's patient (frontend.md → "Patient identity").
   *
   * Everything held for the previous patient is cleared *synchronously*, before any request goes
   * out: between the click and the responses the header reads "Patient" with no chips rather than
   * the sibling's name, age and episode beside the new patient's tabs. Requests still in flight for
   * the previous patient are cancelled, and every response is also checked against the id it was
   * asked for, so a slow answer for A can never land after the switch to B.
   */
  load(patientId: string) {
    this.inflight.unsubscribe();
    this.inflight = new Subscription();
    this.patientId.set(patientId);
    this.patient.set(null);
    this.reactions.set([]);
    this.activeEpisodes.set([]);
    this.careTeam.set([]);
    this.careTeamError.set(null);
    this.error.set(null);
    this.loadPatient();
    this.loadReactions();
    this.loadActiveEpisodes();
    // Loaded at the hub rather than by the Share tab that renders it: the Settings tab resolves the
    // name behind "code status set by ..." out of the same list, and attribution (P3) shouldn't
    // depend on which tab happens to be open.
    this.loadCareTeam();
  }

  /**
   * True while `patientId` is still the hub's patient. Tabs check it before writing a response into
   * the store: a save or delete sent for A that answers after the switch to B must not overwrite
   * B's header or care team.
   */
  isCurrent(patientId: string): boolean {
    return !!patientId && patientId === this.patientId();
  }

  /** A patient returned by a write (`PATCH /patients/:id`), applied only if it is still the hub's. */
  acceptPatient(p: Patient) {
    if (this.isCurrent(p.id)) this.patient.set(p);
  }

  loadPatient() {
    const id = this.patientId();
    this.track(this.api.get<Patient>(`/patients/${id}`).subscribe({
      next: (res) => {
        if (!this.isCurrent(id)) return;
        this.patient.set(res);
        // Hands the tab title its name off this request instead of a second one, and refreshes it
        // after a rename (core/patient-name.store.ts).
        this.names.remember(res);
        this.error.set(null);
      },
      // A patient that can't be read is the whole hub failing, not one tab — say so here rather
      // than letting every tab render its own empty state.
      error: (err) => {
        if (this.isCurrent(id)) this.error.set(errorText(err, 'Could not load this patient.'));
      },
    }));
  }

  loadReactions() {
    const id = this.patientId();
    this.track(this.api
      .get<AdverseReaction[]>(`/patients/${id}/reactions`)
      .subscribe({
        next: (res) => {
          if (this.isCurrent(id)) this.reactions.set(res);
        },
        error: () => {
          if (this.isCurrent(id)) this.reactions.set([]);
        },
      }));
  }

  loadCareTeam() {
    const id = this.patientId();
    this.careTeamLoading.set(true);
    this.careTeamError.set(null);
    this.track(this.api
      .get<{ careTeam?: CareTeamMember[] } | CareTeamMember[]>(
        `/patients/${id}/care-team`
      )
      .subscribe({
        next: (res) => {
          if (!this.isCurrent(id)) return;
          this.careTeam.set(Array.isArray(res) ? res : res.careTeam ?? []);
          this.careTeamLoading.set(false);
        },
        error: (err) => {
          if (!this.isCurrent(id)) return;
          this.careTeamError.set(
            errorText(err, 'Could not load the care team.')
          );
          this.careTeamLoading.set(false);
        },
      }));
  }

  loadActiveEpisodes() {
    const id = this.patientId();
    this.track(this.api
      .get<Episode[]>(`/patients/${id}/episodes`, {
        status: 'active',
      })
      .subscribe({
        next: (res) => {
          if (this.isCurrent(id)) this.activeEpisodes.set(res);
        },
        error: () => {
          if (this.isCurrent(id)) this.activeEpisodes.set([]);
        },
      }));
  }

  private track(sub: Subscription) {
    this.inflight.add(sub);
  }
}
