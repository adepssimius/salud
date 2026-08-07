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
      /* This "button" is an <a>, so it needs the bits a <button> gets for free. */
      .primary {
        display: inline-block;
        text-decoration: none;
        text-align: center;
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
