import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';

// Lands here after GET /auth/oidc/callback redirects the browser with a one-time handoff code
// (security.md → "OIDC login") — this page's only job is to exchange it for the real session and
// get out of the way. There is no form; nothing here is user input.
@Component({
  selector: 'app-oidc-complete-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="auth-card">
      @if (error()) {
        <h1>Sign-in failed</h1>
        <p class="error">{{ error() }}</p>
        <a class="primary" routerLink="/login">Back to login</a>
      } @else {
        <h1>Signing in…</h1>
        <p class="subtext">Finishing sign-in with Authelia.</p>
      }
    </div>
  `,
  styles: [
    `
      .auth-card {
        max-width: 420px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .primary {
        display: inline-block;
        text-decoration: none;
        text-align: center;
      }
    `,
  ],
})
export class OidcCompletePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  error = signal<string | null>(null);

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    if (!code) {
      this.error.set('This sign-in link is missing its code. Start over from the login page.');
      return;
    }
    this.auth.completeOidc(code).subscribe({
      next: () => this.router.navigateByUrl('/dashboard'),
      error: (err) =>
        this.error.set(
          errorText(err, 'This sign-in link has expired or was already used. Try signing in again.'),
        ),
    });
  }
}
