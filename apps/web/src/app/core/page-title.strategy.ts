import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';
import { PatientNameStore } from './patient-name.store';

export const APP_NAME = 'Salud';

/** Route `data` flag marking a route whose `:id` is a patient id. Inherited by hub children. */
export const PATIENT_TITLE = 'patientTitle';

/**
 * The tab shows the patient first: "Ada · Journal · Salud".
 *
 * Titles truncate from the right once a few tabs are open, and the question this product exists to
 * answer at 6 AM is *whose* record is on screen — two caregivers, two devices, possibly two sick
 * kids. Leading with the name means the useful half is the half that survives, and the favicon
 * already says which app it is.
 */
export function composePageTitle(
  patient: string | null,
  page: string | null
): string {
  return [patient, page, APP_NAME].filter(Boolean).join(' · ');
}

/**
 * First name only, because the tab has about a dozen usable characters and that is how a caregiver
 * refers to the patient out loud. A single household does not have first-name collisions worth
 * spending the width on; the hub header still carries the full name.
 */
export function titleName(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}

/** Deepest activated route carrying the patient-title flag, and its `:id`. */
export function patientIdForTitle(state: RouterStateSnapshot): string | null {
  let route: ActivatedRouteSnapshot | null = state.root;
  let id: string | null = null;
  while (route) {
    if (route.data?.[PATIENT_TITLE] && route.params?.['id'])
      id = route.params['id'];
    route = route.firstChild;
  }
  return id;
}

@Injectable({ providedIn: 'root' })
export class SaludTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly names = inject(PatientNameStore);

  private readonly page = signal<string | null>(null);
  private readonly patientId = signal<string | null>(null);

  constructor() {
    super();
    // Reading both signals here is what makes a late-arriving name self-correcting: a deep link
    // renders "ER Brief · Salud" immediately and upgrades to "Ada · ER Brief · Salud" when the
    // fetch lands, with no second navigation. Because the effect always reads the *current* route's
    // patient id, a response for a patient the user has already navigated away from writes nothing.
    effect(() => {
      const id = this.patientId();
      this.title.setTitle(
        composePageTitle(
          id ? titleName(this.names.name(id)) : null,
          this.page()
        )
      );
    });
  }

  override updateTitle(state: RouterStateSnapshot): void {
    const id = patientIdForTitle(state);
    this.page.set(this.buildTitle(state) ?? null);
    this.patientId.set(id);
    if (id) this.names.ensure(id);
  }
}
