import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Condition, Episode } from '@salud/shared/types';
import { ApiClientService } from '../../core/api-client.service';
import { errorText } from '../../core/error-display';
import { PatientHubStore } from '../patient-hub.store';

/**
 * The long view of one patient: the standing frames (conditions), the episodes drawn over the
 * timeline, and the way documents get in (lab import).
 */
@Component({
  selector: 'app-patient-history-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="layout">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Conditions</h2>
            <p class="muted">Standing frames for chronic illness.</p>
          </div>
          <button class="secondary" type="button" (click)="goToNewCondition()">Add condition</button>
        </div>
        <ul class="row-list" *ngIf="conditions().length">
          <li *ngFor="let c of conditions()">
            <button type="button" class="row-button" (click)="goToCondition(c.id)">
              <span class="name">{{ c.name }}</span>
              <span class="pill" [class.pill-success]="c.status === 'active'">{{ c.status }}</span>
            </button>
          </li>
        </ul>
        <p class="muted" *ngIf="!conditions().length">No conditions yet.</p>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Episodes</h2>
            <!-- No "new episode" action, deliberately: episodes only ever start as a side effect of
                 logging an observation or intervention (P5, CLAUDE.md -> Episode model). -->
            <p class="muted">Frames drawn around stretches of the timeline.</p>
          </div>
        </div>
        <div class="error" *ngIf="episodesError()">{{ episodesError() }}</div>
        <ul class="row-list" *ngIf="episodes().length">
          <li *ngFor="let ep of episodes()">
            <button type="button" class="row-button" (click)="goToEpisode(ep.id)">
              <span class="name">{{ ep.name }}</span>
              <span class="meta">
                <span class="muted small" *ngIf="ep.startedAt">
                  {{ ep.startedAt! * 1000 | date: 'mediumDate' }}
                </span>
                <span class="pill" [class.pill-success]="ep.status === 'active'">{{ ep.status }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p class="muted" *ngIf="!episodes().length && !episodesError()">No episodes yet.</p>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Documents &amp; labs</h2>
            <p class="muted">Import a lab report as structured results plus the original PDF.</p>
          </div>
          <button class="secondary" type="button" (click)="goToLabImport()">Import lab report</button>
        </div>
        <p class="muted small">
          Per-analyte history lives in the
          <button type="button" class="link" (click)="goToAnalytes()">analyte catalog</button>.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .card-header {
        align-items: center;
      }
      h2 {
        margin: 0;
      }
      .row-button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .name {
        font-weight: 700;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .pill {
        text-transform: capitalize;
      }
    `,
  ],
})
export class PatientHistoryPage implements OnInit {
  private readonly store = inject(PatientHubStore);
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);

  conditions = signal<Condition[]>([]);
  episodes = signal<Episode[]>([]);
  episodesError = signal<string | null>(null);

  get patientId() {
    return this.store.patientId();
  }

  ngOnInit(): void {
    this.loadConditions();
    this.loadEpisodes();
  }

  private loadConditions() {
    this.api.get<Condition[]>(`/patients/${this.patientId}/conditions`).subscribe({
      next: (res) => this.conditions.set(res),
      error: () => this.conditions.set([]),
    });
  }

  /** Unfiltered: resolved episodes are the point of a history view, not noise in it. */
  private loadEpisodes() {
    this.api.get<Episode[]>(`/patients/${this.patientId}/episodes`).subscribe({
      next: (res) => this.episodes.set(res),
      error: (err) => this.episodesError.set(errorText(err, 'Could not load episodes.')),
    });
  }

  goToNewCondition() {
    this.router.navigate(['/patients', this.patientId, 'conditions', 'new']);
  }

  goToCondition(id: string) {
    this.router.navigate(['/conditions', id]);
  }

  goToEpisode(id: string) {
    this.router.navigate(['/episodes', id]);
  }

  goToLabImport() {
    this.router.navigate(['/patients', this.patientId, 'lab-import']);
  }

  goToAnalytes() {
    this.router.navigate(['/analytes']);
  }
}
