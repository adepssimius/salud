import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  template: `
    <div class="card">
      <h1>Dashboard</h1>
      <p class="subtext">
        Welcome back. This is a placeholder for the caregiver dashboard (patients, schedules, alerts).
      </p>
    </div>
  `,
  styles: [
    `
      .card {
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
    `,
  ],
})
export class DashboardPage {}
