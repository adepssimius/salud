import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { CommonModule } from '@angular/common';
import { TempUnit, LengthUnit, WeightUnit } from '@salud/shared/types';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-card">
      <h1>Sign Up</h1>
      <p class="subtext">Keep everyone on the same page for meds and observations.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Display name</span>
          <input type="text" formControlName="displayName" placeholder="Dr. Smith" />
        </label>
        <label class="field">
          <span>Email</span>
          <input type="email" formControlName="email" placeholder="you@example.com" />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" formControlName="password" placeholder="••••••••" />
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

        <button class="primary" type="submit" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Creating…' : 'Sign Up' }}
        </button>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>

      <p class="muted">
        Already have an account?
        <a routerLink="/login">Sign In</a>
      </p>
    </div>
  `,
  styles: [
    `
      /* Not .card: this is a centred narrow column, not the panelled surface every other page
         means by that name. It sits inside .app-content, which already supplies the chrome. */
      .auth-card {
        max-width: 560px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      /* The auth pages are deliberately a size up from the rest of the app. */
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
      .muted a {
        color: var(--accent-focus);
        text-decoration: none;
      }
      .muted a:hover {
        text-decoration: underline;
      }
      .error {
        margin: 0.25rem 0 0;
      }
    `,
  ],
})
export class RegisterPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    // Nothing links here in OIDC mode -- the login page hides its "Sign Up" link -- but the route
    // still resolves, so a bookmark or browser autocomplete lands on a form whose only possible
    // outcome is 403 PASSWORD_AUTH_DISABLED. Send those people to the one door that works instead
    // of letting them fill in a form to be rejected.
    //
    // A redirect rather than deleting the route: password registration is still the only way into
    // a local dev instance, which can't reach a real Authelia (config/env.ts → authMode()).
    this.auth.authConfig().subscribe({
      next: (res) => {
        if (res.mode === 'oidc') this.router.navigateByUrl('/login');
      },
      // Same posture as the login page: if /auth/config is unreachable, leave the password form
      // up rather than bouncing someone off a page that might be their only way in.
      error: () => undefined,
    });
  }

  form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(1)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    preferredTempUnit: this.fb.control<TempUnit>('F', { nonNullable: true }),
    preferredLengthUnit: this.fb.control<LengthUnit>('cm', { nonNullable: true }),
    preferredWeightUnit: this.fb.control<WeightUnit>('kg', { nonNullable: true }),
  });

  loading = signal(false);
  error = signal<string | null>(null);

  submit() {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    const dto = this.form.getRawValue();
    this.auth.register(dto).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorText(err, 'Unable to create account. Please try again.'));
      },
    });
  }
}
