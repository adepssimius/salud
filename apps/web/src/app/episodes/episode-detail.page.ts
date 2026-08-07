import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { relativeTime, timeAgo } from '../core/relative-time';
import { Episode, TimelineEntry, TimelineResponse } from '@salud/shared/types';

// "What happened during this episode" (frontend.md → Episode detail). Two requests: the episode
// itself for its metadata, and the existing episode-filtered timeline for its hydrated events —
// GET /episodes/:id returns only raw event ids, and the timeline route already does the joining.
@Component({
  selector: 'app-episode-detail-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent, PhotoThumbnailComponent],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="backToPatient()">&larr; Patient</button>

      <ng-container *ngIf="episode() as ep">
        <div class="card-header">
          <div>
            <h1>{{ ep.name }}</h1>
            <p class="muted">
              <span class="pill" [class.pill-neutral]="ep.status === 'resolved'">{{ ep.status }}</span>
              <span *ngIf="ep.startedAt"> · started {{ ago(ep.startedAt) }}</span>
              <span *ngIf="ep.endedAt"> · ended {{ ago(ep.endedAt) }}</span>
            </p>
          </div>
          <div class="header-actions">
            <button type="button" class="secondary" (click)="goToErBrief()">ER Brief</button>
            <button type="button" class="primary" *ngIf="ep.status === 'active'" (click)="resolveEpisode()">
              Resolve this episode
            </button>
          </div>
        </div>

        <p class="muted small" *ngIf="ep.notes">{{ ep.notes }}</p>

        <!-- Resolution is deliberately a side effect of a logged observation, never a direct edit
             (CLAUDE.md → Episode model), so the action above routes into the entry form. -->
        <p class="muted small" *ngIf="ep.status === 'active'">
          Resolving records an observation that closes this episode, so there's always an entry
          explaining why it ended.
        </p>
      </ng-container>

      <section *ngIf="advisories().length">
        <h2>Advisories</h2>
        <app-advisory-banner *ngFor="let a of advisories()" [advisory]="a"></app-advisory-banner>
      </section>

      <section>
        <h2>Events</h2>
        <ul class="events" *ngIf="events().length; else noEvents">
          <li *ngFor="let e of events()">
            <span class="ts">{{ ago(e.timestamp) }}</span>
            <span class="kind">{{ e.kind }}</span>
            <span>{{ describe(e) }}</span>
            <app-photo-thumbnail *ngFor="let fid of photos(e)" [fileId]="fid"></app-photo-thumbnail>
          </li>
        </ul>
        <ng-template #noEvents>
          <p class="muted">No events recorded for this episode yet.</p>
        </ng-template>
      </section>

      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
        color: #e2e8f0;
      }
      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .header-actions {
        display: flex;
        gap: 0.5rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      h2 {
        margin: 0 0 0.5rem;
        font-size: 1.05rem;
      }
      .muted {
        color: #cbd5e1;
        margin: 0;
      }
      .small {
        font-size: 0.85rem;
      }
      .link {
        align-self: flex-start;
        background: none;
        border: none;
        color: #7dd3fc;
        cursor: pointer;
        padding: 0;
      }
      .pill {
        display: inline-flex;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(34, 211, 238, 0.15);
        border: 1px solid rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: capitalize;
      }
      .pill-neutral {
        background: rgba(148, 163, 184, 0.15);
        border-color: rgba(148, 163, 184, 0.4);
        color: #cbd5e1;
      }
      section {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.85rem;
      }
      .events {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .events li {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        font-size: 0.9rem;
        flex-wrap: wrap;
      }
      .ts {
        color: #94a3b8;
        min-width: 110px;
      }
      .kind {
        text-transform: capitalize;
        min-width: 90px;
        color: #7dd3fc;
      }
      .primary,
      .secondary {
        padding: 0.55rem 0.9rem;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
        border: none;
      }
      .primary {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #e2e8f0;
      }
      .error {
        color: #fca5a5;
      }
    `,
  ],
})
export class EpisodeDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  episodeId = '';
  episode = signal<Episode | null>(null);
  events = signal<TimelineEntry[]>([]);
  advisories = signal<any[]>([]);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.episodeId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.episodeId) return;
    this.load();
  }

  private load() {
    this.api.get<Episode>(`/episodes/${this.episodeId}`).subscribe({
      next: (ep) => {
        this.episode.set(ep);
        this.loadEvents(ep.patientId);
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load this episode.')),
    });
  }

  // The episode's own event list comes from the timeline filtered to this episode — GET
  // /episodes/:id returns ids only, and this route already resolves medication names and entries.
  private loadEvents(patientId: string) {
    this.api
      .get<TimelineResponse>(`/patients/${patientId}/timeline`, { episodeId: this.episodeId })
      .subscribe({
        next: (res) => {
          this.events.set(res.entries.filter((e) => e.kind !== 'advisory'));
          this.advisories.set(res.entries.filter((e) => e.kind === 'advisory').map((e) => e.display));
        },
        error: (err) => this.error.set(errorText(err, 'Unable to load this episode’s events.')),
      });
  }

  ago(ts: number) {
    return timeAgo(ts);
  }

  until(ts: number) {
    return relativeTime(ts);
  }

  describe(entry: TimelineEntry): string {
    return describeEvent(entry, unitsFor(this.auth.user()));
  }

  photos(entry: TimelineEntry): string[] {
    return photoFileIds(entry);
  }

  // No resolve endpoint exists by design — an episode closes as the side effect of a logged
  // observation (CLAUDE.md → Episode model), so this hands off to the entry form pre-selected.
  resolveEpisode() {
    const ep = this.episode();
    if (!ep) return;
    this.router.navigate(['/observations/new'], {
      queryParams: { patientId: ep.patientId, resolveEpisodeId: ep.id },
    });
  }

  goToErBrief() {
    const ep = this.episode();
    if (!ep) return;
    this.router.navigate(['/patients', ep.patientId, 'er-brief'], {
      queryParams: { episodeId: ep.id },
    });
  }

  backToPatient() {
    const ep = this.episode();
    this.router.navigate(ep ? ['/patients', ep.patientId] : ['/dashboard']);
  }
}
