import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { TempUnit, LengthUnit, WeightUnit } from '@salud/shared/types';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="layout">
      <aside class="tabs">
        <div class="tab active">My Profile</div>
        <div class="tab disabled">Notifications (coming soon)</div>
      </aside>

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
        </form>
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
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        font-weight: 600;
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
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.8rem;
      }
      .subtext {
        margin: 0;
        color: #cbd5e1;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.95rem;
      }
      input,
      select {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      input:focus,
      select:focus {
        outline: 2px solid #38bdf8;
        border-color: transparent;
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
        border-radius: 10px;
        border: none;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
        font-weight: 700;
        cursor: pointer;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .muted {
        color: #cbd5e1;
      }
    `,
  ],
})
export class ProfilePage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(1)]],
    preferredTempUnit: this.fb.control<TempUnit>('F', { nonNullable: true }),
    preferredLengthUnit: this.fb.control<LengthUnit>('cm', { nonNullable: true }),
    preferredWeightUnit: this.fb.control<WeightUnit>('kg', { nonNullable: true }),
  });

  saving = signal(false);
  saved = signal(false);

  ngOnInit(): void {
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
    const dto = this.form.getRawValue();
    this.auth.updateProfile(dto).subscribe({
      next: (res) => {
        this.patchFromUser(res.user);
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => {
        this.saving.set(false);
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
