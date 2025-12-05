import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h1>Dashboard</h1>
      <p class="subtext">
        Welcome back. This is a placeholder for the caregiver dashboard (patients, schedules, alerts).
      </p>
      <div class="actions">
        <button class="primary" type="button" (click)="goToNewObservation()">Create observation</button>
        <button class="secondary" type="button" (click)="goToNewIntervention()">Log intervention</button>
      </div>
      <div class="episodes" *ngIf="episodes().length">
        <h3>Active episodes</h3>
        <ul>
          <li *ngFor="let ep of episodes()">
            <strong>{{ ep.name }}</strong>
            <span class="muted">— {{ ep.patientName }}</span>
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: [
    `
      .card {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .subtext {
        margin: 0;
        color: #cbd5e1;
      }
      .actions {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.5rem;
      }
      .primary {
        padding: 0.7rem 1.1rem;
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
        font-weight: 700;
        cursor: pointer;
      }
      .secondary {
        padding: 0.7rem 1.1rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
      }
      .episodes {
        margin-top: 1rem;
      }
      .episodes ul {
        list-style: none;
        padding: 0;
        margin: 0.35rem 0 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .episodes li {
        padding: 0.35rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
    `,
  ],
})
export class DashboardPage implements OnInit {
  private readonly router = inject(Router);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  episodes = signal<Array<{ id: string; name: string; patientId: string; patientName: string }>>([]);

  ngOnInit(): void {
    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadEpisodes(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadEpisodes();
    }
  }

  private loadEpisodes() {
    this.api.get<Array<{ id: string; name: string; patientId: string; patientName: string }>>('/episodes/active').subscribe({
      next: (res) => this.episodes.set(res),
      error: () => this.episodes.set([]),
    });
  }

  goToNewObservation() {
    this.router.navigate(['/observations/new']);
  }

  goToNewIntervention() {
    this.router.navigate(['/interventions/new']);
  }
}
