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
      }
      .card-header {
        flex-wrap: wrap;
      }
      .muted {
        margin: 0;
      }
      .link {
        align-self: flex-start;
      }
      .pill {
        text-transform: capitalize;
      }
      section {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.85rem;
      }
      .events li {
        align-items: center;
        font-size: 0.9rem;
        flex-wrap: wrap;
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
