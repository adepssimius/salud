import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-card">
      <h1>Sign In</h1>
      <p class="subtext">Sign in to access your family's health dashboard.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Email</span>
          <input type="email" formControlName="email" placeholder="you@example.com" />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" formControlName="password" placeholder="••••••••" />
        </label>

        <button class="primary" type="submit" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Signing in…' : 'Sign In' }}
        </button>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>

      <p class="muted">
        Don't have an account?
        <a routerLink="/register">Sign Up</a>
      </p>
    </div>
  `,
  styles: [
    `
      /* Not .card: this is a centred narrow column, not the panelled surface every other page
         means by that name. It sits inside .app-content, which already supplies the chrome. */
      .auth-card {
        max-width: 420px;
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
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(1)]],
  });

  loading = signal(false);
  error = signal<string | null>(null);

  submit() {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login({ email, password }).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorText(err, 'Unable to sign in. Please try again.'));
      },
    });
  }
}
