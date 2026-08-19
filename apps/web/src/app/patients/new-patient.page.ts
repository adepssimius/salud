import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { CareTeamRole, CreatePatientDto, SexAtBirth } from '@salud/shared/types';

@Component({
  selector: 'app-new-patient-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <h1>Add Patient</h1>
      <p class="muted">Add a new patient and set your relationship.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Full name</span>
          <input type="text" formControlName="fullName" />
        </label>

        <label class="field">
          <span>Date of birth</span>
          <input type="date" formControlName="dateOfBirth" />
        </label>

        <label class="field">
          <span>Sex at birth</span>
          <select formControlName="sexAtBirth">
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>

        <label class="field">
          <span>Your relationship</span>
          <select formControlName="myRole">
            <option *ngFor="let role of roles" [value]="role">{{ role }}</option>
          </select>
        </label>

        <label class="field">
          <span>Notes (optional)</span>
          <textarea rows="3" formControlName="notes"></textarea>
        </label>

        <div class="actions">
          <button class="secondary" type="button" (click)="cancel()">Cancel</button>
          <button class="primary" type="submit" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Creating…' : 'Create patient' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .muted {
        margin: 0;
      }
      form {
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class NewPatientPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  roles: CareTeamRole[] = ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'];

  form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(1)]],
    dateOfBirth: ['', [Validators.required]],
    sexAtBirth: this.fb.control<SexAtBirth>('female', { nonNullable: true }),
    myRole: this.fb.control<CareTeamRole>('parent', { nonNullable: true }),
    notes: [''],
  });

  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.auth.user() && this.auth.token) {
      this.auth.me().subscribe({
        error: () => this.auth.logout(),
      });
    }
  }

  submit() {
    if (this.form.invalid || this.saving()) return;
    const user = this.auth.user();
    if (!user) {
      this.error.set('You must be signed in.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const body: CreatePatientDto = {
      ...this.form.getRawValue(),
    };
    this.api.post<{ patient: unknown }>(`/patients`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/patients']);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not create patient right now.'));
      },
    });
  }

  cancel() {
    this.router.navigateByUrl('/patients');
  }
}
