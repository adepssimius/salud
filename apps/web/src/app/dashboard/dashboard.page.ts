import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';

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
    `,
  ],
})
export class DashboardPage {
  constructor(private readonly router: Router) {}

  goToNewObservation() {
    this.router.navigate(['/observations/new']);
  }

  goToNewIntervention() {
    this.router.navigate(['/interventions/new']);
  }
}
