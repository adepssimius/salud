import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-logout-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="auth-card">
      <h1>Signed out</h1>
      <p class="subtext">You have been logged out. Sign in again to continue.</p>
      <a class="primary" routerLink="/login">Back to login</a>
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
        gap: 0.75rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .subtext {
        margin: 0;
        color: #cbd5e1;
      }
      .primary {
        display: inline-block;
        padding: 0.65rem 0.9rem;
        border-radius: 10px;
        border: none;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
        font-weight: 700;
        text-decoration: none;
        text-align: center;
      }
      .primary:hover {
        box-shadow: 0 8px 20px rgba(34, 211, 238, 0.35);
      }
    `,
  ],
})
export class LogoutPage implements OnInit {
  private readonly auth = inject(AuthService);

  ngOnInit(): void {
    this.auth.logout();
  }
}
