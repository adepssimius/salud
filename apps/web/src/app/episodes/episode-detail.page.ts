import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { relativeTime, timeAgo } from '../core/relative-time';
import { Episode, EpisodeEventRef, TimelineEntry, TimelineResponse, UpdateEpisodeEventsRequest } from '@salud/shared/types';
import { EpisodeEntryPickerComponent, PickedEntry, entryKey } from './episode-entry-picker.component';

// "What happened during this episode" (frontend.md → Episode detail). Two requests: the episode
// itself for its metadata, and the existing episode-filtered timeline for its hydrated events —
// GET /episodes/:id returns only raw event ids, and the timeline route already does the joining.
@Component({
  selector: 'app-episode-detail-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent, PhotoThumbnailComponent, EpisodeEntryPickerComponent],
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
        <div class="section-header">
          <h2>Events</h2>
          <button type="button" class="secondary" *ngIf="episode() && !adding()" (click)="startAdding()">
            Add entries
          </button>
        </div>

        <!-- Membership is edited from here too (frontend.md -> Episode detail). Each change is a
             correction of that entry, through the same rules as its own edit form. -->
        <div class="adding" *ngIf="adding() && episode() as ep">
          <p class="muted small">Choose entries to add to this episode.</p>
          <app-episode-entry-picker
            [patientId]="ep.patientId"
            [exclude]="memberKeys()"
            emptyText="Every entry for this patient is already in this episode."
            (selectionChange)="toAdd.set($event)"
          ></app-episode-entry-picker>
          <div class="actions">
            <button type="button" class="secondary" (click)="adding.set(false)">Cancel</button>
            <button type="button" class="primary" [disabled]="!toAdd().length || busy()" (click)="addSelected()">
              Add {{ toAdd().length || '' }} {{ toAdd().length === 1 ? 'entry' : 'entries' }}
            </button>
          </div>
        </div>

        <ul class="events" *ngIf="events().length; else noEvents">
          <li *ngFor="let e of events()">
            <span class="ts">{{ ago(e.timestamp) }}</span>
            <span class="kind">{{ e.kind }}</span>
            <button type="button" class="feed-text-link" (click)="openEvent(e)">{{ describe(e) }}</button>
            <app-photo-thumbnail *ngFor="let fid of photos(e)" [fileId]="fid"></app-photo-thumbnail>
            <span class="row-end">
              <span class="pill pill-neutral role" *ngIf="isStart(e)">started this episode</span>
              <span class="pill pill-neutral role" *ngIf="isEnd(e)">ended it</span>
              <button
                type="button"
                class="link remove"
                *ngIf="events().length > 1"
                [disabled]="busy()"
                (click)="remove(e)"
              >
                Remove
              </button>
            </span>
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
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .adding {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .row-end {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .remove {
        color: var(--danger-text);
      }
      .pill.role {
        text-transform: none;
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
  adding = signal(false);
  toAdd = signal<PickedEntry[]>([]);
  busy = signal(false);
  memberKeys = computed(() => new Set(this.events().map((e) => entryKey(e))));

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

  /**
   * Through to the event's read-only detail page (frontend.md → "Observation & intervention
   * detail"), same affordance the journal feed carries. Advisories are split out of `events()`
   * above and rendered as banners, so nothing here can be one.
   */
  openEvent(entry: TimelineEntry) {
    if (entry.kind === 'advisory') return;
    this.router.navigate([entry.kind === 'observation' ? '/observations' : '/interventions', entry.id]);
  }

  isStart(e: TimelineEntry): boolean {
    const ep = this.episode();
    return !!ep && ep.startedAtType === e.kind && ep.startedAtId === e.id;
  }

  isEnd(e: TimelineEntry): boolean {
    const ep = this.episode();
    return !!ep && ep.endedAtType === e.kind && ep.endedAtId === e.id;
  }

  startAdding() {
    this.toAdd.set([]);
    this.adding.set(true);
  }

  addSelected() {
    const add = this.toAdd().map(({ type, id }) => ({ type, id }));
    if (!add.length) return;
    this.save({ add }, () => this.adding.set(false));
  }

  /**
   * Any entry can be removed, the start included: the next-earliest entry then starts the episode,
   * and the page re-renders from the Episode the call returns (data-model.md → "An episode starts
   * at its earliest entry"). A lone entry has no Remove (EPISODE_LAST_ENTRY). Removing the entry that ended
   * the episode reopens it, which is worth a confirm — it changes the episode's status, not just
   * its contents.
   */
  remove(e: TimelineEntry) {
    if (this.isEnd(e) && !window.confirm('This entry ended the episode. Removing it reopens the episode. Continue?')) {
      return;
    }
    const ref: EpisodeEventRef = { type: e.kind as EpisodeEventRef['type'], id: e.id };
    this.save({ remove: [ref] });
  }

  private save(body: UpdateEpisodeEventsRequest, done?: () => void) {
    this.busy.set(true);
    this.error.set(null);
    this.api.post<Episode>(`/episodes/${this.episodeId}/events`, body).subscribe({
      next: (ep) => {
        this.busy.set(false);
        this.episode.set(ep);
        this.loadEvents(ep.patientId);
        done?.();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(err, 'Could not update this episode’s entries.'));
      },
    });
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
