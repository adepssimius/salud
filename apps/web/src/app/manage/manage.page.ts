import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Household-level setup, off the avatar menu (frontend.md → "Information architecture (v2)" →
 * Home: "Catalog and admin actions leave Home").
 *
 * These three actions used to sit in Home's action row. They are monthly tasks — a catalog is
 * seeded once and edited when a new medication enters the house — and they were competing for
 * space with "log a dose" on the most urgent screen in the app. Moving them costs a tap on a task
 * nobody does at 3 AM and buys the top of Home back for the ones people do.
 */
@Component({
  selector: 'app-manage-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card">
      <h1>Manage</h1>
      <p class="muted small">Household setup — the catalogs and recurring schedules.</p>
      <ul class="row-list">
        <li><a class="link" routerLink="/medications">Medication catalog</a></li>
        <li><a class="link" routerLink="/analytes">Analyte catalog</a></li>
        <li><a class="link" routerLink="/schedules/new">New schedule</a></li>
      </ul>
    </div>
  `,
  styles: [
    `
      .card {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .row-list li {
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-input);
        border: 1px solid var(--border);
      }
      a.link {
        text-decoration: none;
        font-weight: 600;
      }
    `,
  ],
})
export class ManagePage {}
