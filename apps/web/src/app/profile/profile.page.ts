import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { TempUnit, LengthUnit, WeightUnit } from '@salud/shared/types';

/**
 * The caregiver's own settings, and nothing else. The patient list moved out to `/patients`
 * (frontend.md → "Information architecture (v2)"): patients are one of the app's two top-level
 * axes, not a tab inside the signed-in user's preferences. With one pane left, the tab rail went
 * with it.
 */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
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
  `,
  styles: [
    `
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      h1 {
        font-size: 1.8rem;
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
    `,
  ],
})
export class ProfilePage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
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

  ngOnInit(): void {
    // `?tab=patients` was how the patient list was reached for the whole life of this page, so it
    // is in bookmarks and in old links. Forward it rather than silently showing the profile form.
    if (this.route.snapshot.queryParamMap.get('tab') === 'patients') {
      this.router.navigateByUrl('/patients');
      return;
    }

    const cached = this.auth.user();
    if (cached) {
      this.patchFromUser(cached);
    } else if (this.auth.token) {
      this.auth.me().subscribe({
        next: (res) => this.patchFromUser(res.user),
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

  private patchFromUser(user: { displayName: string; preferredTempUnit: TempUnit; preferredLengthUnit: LengthUnit; preferredWeightUnit: WeightUnit }) {
    this.form.patchValue({
      displayName: user.displayName,
      preferredTempUnit: user.preferredTempUnit,
      preferredLengthUnit: user.preferredLengthUnit,
      preferredWeightUnit: user.preferredWeightUnit,
    });
  }
}
