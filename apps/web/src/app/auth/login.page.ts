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
    <div class="card">
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
      .card {
        max-width: 420px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
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
      input {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      input:focus {
        outline: 2px solid #38bdf8;
        border-color: transparent;
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
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .primary:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 20px rgba(34, 211, 238, 0.35);
      }
      .muted {
        color: #cbd5e1;
      }
      .muted a {
        color: #38bdf8;
        text-decoration: none;
      }
      .muted a:hover {
        text-decoration: underline;
      }
      .error {
        color: #fca5a5;
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
