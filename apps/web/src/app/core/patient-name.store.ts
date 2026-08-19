import { Injectable, computed, inject, signal } from '@angular/core';
import { Patient } from '@salud/shared/types';
import { ApiClientService } from './api-client.service';

/**
 * A tiny root-level cache of patient names, kept for the browser tab title.
 *
 * The title has to be set on `NavigationEnd`, before any page has loaded its data, so it needs a
 * name from somewhere that is not the page. Rather than a resolver — which would issue a second
 * `GET /patients/:id` alongside the one `PatientHubStore` already makes on every hub visit — pages
 * that load patients `remember()` them here as they arrive, and `ensure()` only reaches the network
 * for an id nobody has published yet (a deep link straight into `/patients/:id/er-brief`, say).
 *
 * Names are cached for the session and refreshed whenever a page republishes one, so a rename shows
 * up in the title as soon as the hub reloads the patient.
 */
@Injectable({ providedIn: 'root' })
export class PatientNameStore {
  private readonly api = inject(ApiClientService);
  private readonly names = signal<Record<string, string>>({});
  /** Ids with a request in flight or already resolved, so `ensure` fetches an id at most once. */
  private readonly requested = new Set<string>();

  /** Reactive lookup — the title strategy re-renders through this when a fetch lands. */
  readonly lookup = computed(() => this.names());

  name(patientId: string): string | null {
    return this.names()[patientId] ?? null;
  }

  /** Publish a name already in hand. Free: the caller fetched the patient for its own reasons. */
  remember(patient: Pick<Patient, 'id' | 'fullName'>): void {
    if (!patient?.id || !patient.fullName) return;
    if (this.names()[patient.id] === patient.fullName) return;
    this.requested.add(patient.id);
    this.names.update((n) => ({ ...n, [patient.id]: patient.fullName }));
  }

  rememberAll(patients: readonly Pick<Patient, 'id' | 'fullName'>[]): void {
    for (const p of patients ?? []) this.remember(p);
  }

  /**
   * Fetch a name we have never seen. Failures are swallowed on purpose: a patient the caller cannot
   * read (404 by design — see CLAUDE.md → access control) should leave the tab title alone, not
   * surface an error in the one piece of chrome that has nowhere to put it.
   */
  ensure(patientId: string): void {
    if (!patientId || this.requested.has(patientId)) return;
    this.requested.add(patientId);
    this.api.get<Patient>(`/patients/${patientId}`).subscribe({
      next: (p) => this.remember(p),
      error: () => this.requested.delete(patientId),
    });
  }
}
