import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { TempUnit, LengthUnit, WeightUnit, Patient } from '@salud/shared/types';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="layout">
      <aside class="tabs">
        <button
          type="button"
          class="tab"
          [class.active]="selectedTab() === 'profile'"
          (click)="selectTab('profile')"
        >
          My Profile
        </button>
        <button
          type="button"
          class="tab"
          [class.active]="selectedTab() === 'patients'"
          (click)="selectTab('patients')"
        >
          Patients
        </button>
        <div class="tab disabled">Notifications (coming soon)</div>
      </aside>

      <div class="card" *ngIf="selectedTab() === 'profile'">
        <h1>My Profile</h1>
        <p class="subtext">Update your name and preferred units.</p>

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label class="field">
            <span>Display name</span>
            <input type="text" formControlName="displayName" />
          </label>

          <div class="preferences">
            <label class="field">
              <span>Temperature unit</span>
              <select formControlName="preferredTempUnit">
                <option value="F">°F</option>
                <option value="C">°C</option>
              </select>
            </label>
            <label class="field">
              <span>Length unit</span>
              <select formControlName="preferredLengthUnit">
                <option value="cm">cm</option>
                <option value="in">inches</option>
              </select>
            </label>
            <label class="field">
              <span>Weight unit</span>
              <select formControlName="preferredWeightUnit">
                <option value="kg">kg</option>
                <option value="lb">lb</option>
                <option value="st">st</option>
              </select>
            </label>
          </div>

          <button class="primary" type="submit" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
          <p class="muted" *ngIf="saved()">Saved.</p>
          <p class="error" *ngIf="saveError()">{{ saveError() }}</p>
        </form>
      </div>

      <div class="card" *ngIf="selectedTab() === 'patients'">
        <div class="card-header">
          <div>
            <h1>Patients</h1>
            <p class="subtext">Your patients and your relationship to each.</p>
          </div>
          <button class="secondary" type="button" (click)="startAddPatient()">Add patient</button>
        </div>

        <div *ngIf="patientsLoading()">Loading patients…</div>
        <div *ngIf="patientsError()" class="error">{{ patientsError() }}</div>

        <ul class="patient-list" *ngIf="!patientsLoading() && patients().length">
          <li *ngFor="let patient of patients()">
            <button type="button" class="patient-button" (click)="goToPatient(patient.id)">
              <div class="patient-name">{{ patient.fullName }}</div>
              <div class="patient-meta">
                <span class="pill">{{ patient.myRole ?? '—' }}</span>
                <span class="muted">DOB: {{ patient.dateOfBirth }}</span>
                <span class="pill pill-success" *ngIf="patient.ownedById === currentUserId()">Owner</span>
              </div>
            </button>
          </li>
        </ul>
        <p class="muted" *ngIf="!patientsLoading() && !patients().length">No patients yet.</p>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 1.25rem;
        align-items: start;
      }
      @media (max-width: 640px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .tabs {
          flex-direction: row;
          gap: 0.5rem;
        }
      }
      .tabs {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .tab {
        border: none;
        text-align: left;
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        font-weight: 600;
        cursor: pointer;
      }
      .tab.active {
        background: rgba(34, 211, 238, 0.12);
        border-color: rgba(34, 211, 238, 0.4);
        color: #e2e8f0;
      }
      .tab.disabled {
        opacity: 0.5;
      }
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      h1 {
        font-size: 1.8rem;
      }
      .card-header {
        align-items: center;
      }
      .field {
        font-size: 0.95rem;
      }
      .preferences {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.75rem;
        margin-top: 0.25rem;
      }
      .primary {
        margin-top: 0.25rem;
        padding: 0.75rem 1rem;
      }
      .patient-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }
      .patient-list li {
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
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
        border-radius: 10px;
      }
      .patient-name {
        font-weight: 700;
        margin-bottom: 0.25rem;
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
export class ProfilePage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(1)]],
    preferredTempUnit: this.fb.control<TempUnit>('F', { nonNullable: true }),
    preferredLengthUnit: this.fb.control<LengthUnit>('cm', { nonNullable: true }),
    preferredWeightUnit: this.fb.control<WeightUnit>('kg', { nonNullable: true }),
  });

  saving = signal(false);
  saved = signal(false);
  saveError = signal<string | null>(null);
  selectedTab = signal<'profile' | 'patients'>('profile');
  patients = signal<Patient[]>([]);
  patientsLoading = signal(false);
  patientsError = signal<string | null>(null);
  private patientsLoaded = signal(false);
  protected currentUserId = computed(() => this.auth.user()?.id ?? null);

  ngOnInit(): void {
    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    if (requestedTab === 'patients') {
      this.selectedTab.set('patients');
    }

    const cached = this.auth.user();
    if (cached) {
      this.patchFromUser(cached);
      this.ensurePatientsLoaded();
    } else if (this.auth.token) {
      this.auth.me().subscribe({
        next: (res) => {
          this.patchFromUser(res.user);
          this.ensurePatientsLoaded();
        },
        error: () => this.auth.logout(),
      });
    }
  }

  submit() {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(null);
    const dto = this.form.getRawValue();
    this.auth.updateProfile(dto).subscribe({
      next: (res) => {
        this.patchFromUser(res.user);
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(errorText(err, 'Could not save your profile.'));
      },
    });
  }

  selectTab(tab: 'profile' | 'patients') {
    this.selectedTab.set(tab);
    if (tab === 'patients') {
      this.ensurePatientsLoaded();
    }
  }

  startAddPatient() {
    this.router.navigateByUrl('/patients/new');
  }

  private patchFromUser(user: { displayName: string; preferredTempUnit: TempUnit; preferredLengthUnit: LengthUnit; preferredWeightUnit: WeightUnit }) {
    this.form.patchValue({
      displayName: user.displayName,
      preferredTempUnit: user.preferredTempUnit,
      preferredLengthUnit: user.preferredLengthUnit,
      preferredWeightUnit: user.preferredWeightUnit,
    });
  }

  private ensurePatientsLoaded() {
    if (this.patientsLoaded() || !this.currentUserId()) return;
    this.loadPatients();
  }

  goToPatient(id: string) {
    this.router.navigate(['/patients', id]);
  }

  private loadPatients() {
    this.patientsLoading.set(true);
    this.patientsError.set(null);
    this.api.get<{ patients?: Patient[] } | Patient[]>(`/patients`).subscribe({
      next: (res) => {
        const list = Array.isArray(res) ? res : res.patients ?? [];
        this.patients.set(list);
        this.patientsLoaded.set(true);
        this.patientsLoading.set(false);
      },
      error: (err) => {
        this.patientsError.set(errorText(err, 'Unable to load patients right now.'));
        this.patientsLoading.set(false);
      },
    });
  }
}
