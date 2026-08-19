import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { Patient } from '@salud/shared/types';

/**
 * The household's patients, promoted out of `/profile?tab=patients` to a top-level destination
 * (frontend.md → "Information architecture (v2)"). Patient-level work is one of the app's two
 * top-level axes; reaching it through the caregiver's own settings page put it a level below where
 * it belongs, and left `/profile` owning two unrelated concerns.
 */
@Component({
  selector: 'app-patients-list-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <div class="card-header">
        <div>
          <h1>Patients</h1>
          <p class="subtext">Your patients and your relationship to each.</p>
        </div>
        <button class="secondary" type="button" (click)="startAddPatient()">Add patient</button>
      </div>

      <div *ngIf="loading()">Loading patients…</div>
      <!-- A failed read must say so rather than rendering as an empty list (frontend.md → Errors &
           failure messages): "no patients" and "we couldn't ask" are different answers. -->
      <div class="error" *ngIf="error()">{{ error() }}</div>

      <ul class="row-list patient-list" *ngIf="!loading() && patients().length">
        <!-- Each row carries the patient's accent color (frontend.md → "Patient identity"): this
             list is where a caregiver picks whose record to open, so it is the first place the
             color has to be learnable, and the last place two children should look alike. -->
        <li *ngFor="let patient of patients()" class="accent-rail" [ngClass]="accentClass(patient)">
          <button type="button" class="patient-button" (click)="goToPatient(patient.id)">
            <div class="patient-name"><span class="accent-dot"></span>{{ patient.fullName }}</div>
            <div class="patient-meta">
              <span class="pill">{{ patient.myRole ?? '—' }}</span>
              <span class="muted">DOB: {{ patient.dateOfBirth }}</span>
              <span class="pill pill-success" *ngIf="patient.ownedById === currentUserId()">Owner</span>
            </div>
          </button>
        </li>
      </ul>
      <p class="muted" *ngIf="!loading() && !error() && !patients().length">
        No patients yet. Add one to start logging.
      </p>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .card-header {
        align-items: center;
      }
      h1 {
        font-size: 1.8rem;
      }
      .patient-list {
        gap: 0.65rem;
      }
      /* Three sides, not the border shorthand: the leading edge belongs to the global
         .accent-rail utility, and a shorthand here (specificity 0,2,1 against the utility's 0,1,0)
         would quietly paint over it. */
      .patient-list li {
        border-radius: var(--radius-control);
        background: var(--surface-raised);
        border-top: 1px solid var(--border);
        border-right: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
      }
      .patient-button {
        width: 100%;
        padding: 0.75rem;
        text-align: left;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
        border-radius: var(--radius-control);
      }
      .patient-name {
        font-weight: 700;
        margin-bottom: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .patient-meta {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .pill {
        text-transform: capitalize;
      }
    `,
  ],
})
export class PatientsListPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  patients = signal<Patient[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  protected currentUserId = computed(() => this.auth.user()?.id ?? null);

  ngOnInit(): void {
    if (!this.auth.user() && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadPatients(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadPatients();
    }
  }

  // An unrecognised token matches no palette rule, so the row keeps the neutral fallback rather
  // than losing its rail entirely — see the palette block in styles.css.
  protected accentClass(patient: Patient) {
    return patient.accentColor ? `accent-${patient.accentColor}` : '';
  }

  startAddPatient() {
    this.router.navigateByUrl('/patients/new');
  }

  goToPatient(id: string) {
    this.router.navigate(['/patients', id]);
  }

  private loadPatients() {
    this.loading.set(true);
    this.error.set(null);
    // Tolerates both response shapes the API has returned historically (array or `{ patients }`),
    // same as the profile page did before this moved.
    this.api.get<{ patients?: Patient[] } | Patient[]>('/patients').subscribe({
      next: (res) => {
        this.patients.set(Array.isArray(res) ? res : res.patients ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorText(err, 'Unable to load patients right now.'));
        this.loading.set(false);
      },
    });
  }
}
