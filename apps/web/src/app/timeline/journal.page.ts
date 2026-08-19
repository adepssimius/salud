import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, documentAttachments, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { timeAgo } from '../core/relative-time';
import { Episode, Medication, TimelineEntry, TimelineResponse, WhatsNewResponse } from '@salud/shared/types';
import { JournalChartComponent } from './journal-chart.component';
import { DocumentLinkComponent } from './document-link.component';

/** One rendered line in the feed. */
interface FeedRow {
  entry: TimelineEntry;
  /** Author's display name, or null for an advisory — the engine fires those, nobody writes them. */
  author: string | null;
  text: string;
  photoFileIds: string[];
  documents: Array<{ fileId: string; label: string }>;
  /** Logged after this reader's watermark. */
  unseen: boolean;
}

/** An episode frame entered at this point in the feed — "— Fever, day 3 —". */
interface EpisodeDivider {
  episodeId: string;
  label: string;
}

interface FeedDay {
  /** Midnight of the day, epoch seconds — the group key and the sort key. */
  dayStart: number;
  label: string;
  items: Array<{ dividers: EpisodeDivider[]; row: FeedRow }>;
}

const DAY_SECONDS = 86400;

/** Chart open by default where there's room for it beside the feed; collapsed on a phone. */
function prefersChartOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 900px)').matches;
}

/**
 * The Journal — the patient hub's narrative tab (frontend.md → "Information architecture (v2)" →
 * Journal). Supersedes the chart-only Timeline page and the separate What's-New page.
 *
 * The product's promise is a *shared narrative*, so the narrative artifact is the feed and the
 * chart is its instrument panel: a collapsible header above the feed on a phone, a second column
 * beside it on a desktop (P7). One fetch feeds both, so the medication/tag chips filter the chart
 * and the feed together by construction.
 *
 * Every row is attributed by name and time — "Dana — 240 mg ibuprofen · 2:15 AM" (P3). The names
 * ride in on the payload as `recordedBy` (api.md → Timeline & dashboard); this page never maps a
 * user id itself, and a row keeps its author after that caregiver leaves the care team.
 *
 * **The since-you-last-looked marker is the handoff.** It renders as a labeled divider inside the
 * feed: the reader opens the journal and reads down to the line. Scrolling past it never acks —
 * only the explicit button does, so a caregiver who opens this, gets pulled away and closes the tab
 * has not silently consumed the briefing (frontend.md → While You Were Asleep, ack semantics).
 */
@Component({
  selector: 'app-journal-page',
  standalone: true,
  imports: [CommonModule, JournalChartComponent, PhotoThumbnailComponent, DocumentLinkComponent],
  template: `
    <div class="journal">
      <section class="card journal-chart-card">
        <div class="journal-chart-head">
          <h2>Chart</h2>
          <button type="button" class="link" (click)="toggleChart()">
            {{ chartOpen() ? 'Hide chart' : 'Show chart' }}
          </button>
        </div>

        <div class="filters">
          <span class="filter-label">Medication:</span>
          <button type="button" class="chip" [class.active]="!selectedMedicationId()" (click)="clearFilters()">
            All
          </button>
          <button
            type="button"
            class="chip"
            *ngFor="let m of medications()"
            [class.active]="selectedMedicationId() === m.id"
            (click)="filterByMedication(m.id)"
          >
            {{ m.name }}
          </button>
        </div>
        <div class="filters" *ngIf="allTags().length">
          <span class="filter-label">Tag:</span>
          <button
            type="button"
            class="chip"
            *ngFor="let tag of allTags()"
            [class.active]="selectedTag() === tag"
            (click)="filterByTag(tag)"
          >
            {{ tag }}
          </button>
        </div>

        <app-journal-chart
          *ngIf="chartOpen()"
          [entries]="entries()"
          [episodes]="episodes()"
          [temperatureRanges]="temperatureRanges()"
          (episodeSelected)="goToEpisode($event)"
        ></app-journal-chart>
      </section>

      <section class="card journal-feed-card">
        <div class="journal-feed-head">
          <h2>Journal</h2>
          <!-- The feed shows a photo where it was logged; the progression of one site over days is
               a different read, and this is where a caregiver looking at today's photo asks for it
               (frontend.md → Photos → "Photos by site"). -->
          <button type="button" class="link" (click)="goToPhotos()">Photos by site</button>
        </div>

        <p class="error" *ngIf="error()">{{ error() }}</p>

        <p class="muted" *ngIf="!error() && !feed().length">Nothing logged in this view yet.</p>

        <div class="feed-day" *ngFor="let day of feed()">
          <h3 class="feed-day-label">{{ day.label }}</h3>

          <ng-container *ngFor="let item of day.items">
            <button
              type="button"
              class="episode-divider"
              *ngFor="let divider of item.dividers"
              (click)="goToEpisode(divider.episodeId)"
            >
              <span>— {{ divider.label }} —</span>
            </button>

            <article class="feed-row" [class.unseen]="item.row.unseen">
              <div class="feed-line">
                <span class="feed-author" *ngIf="item.row.author; else systemAuthor">{{ item.row.author }}</span>
                <ng-template #systemAuthor><span class="feed-author feed-author-system">Salud</span></ng-template>
                <span class="feed-dash">—</span>
                <span class="feed-text">{{ item.row.text }}</span>
                <span class="feed-time">· {{ item.row.entry.timestamp * 1000 | date: 'shortTime' }}</span>
              </div>
              <div class="feed-attachments" *ngIf="item.row.photoFileIds.length || item.row.documents.length">
                <app-photo-thumbnail
                  *ngFor="let fid of item.row.photoFileIds"
                  [fileId]="fid"
                ></app-photo-thumbnail>
                <app-document-link
                  *ngFor="let doc of item.row.documents"
                  [fileId]="doc.fileId"
                  [label]="doc.label"
                ></app-document-link>
              </div>
            </article>

            <div class="watermark" *ngIf="watermarkAfterEntryId() === item.row.entry.id">
              <span class="watermark-label">
                {{ acked() ? 'Marked as seen' : 'New since you last looked' }}
                <span class="muted small" *ngIf="since() as s"> · {{ sinceLabel(s) }}</span>
              </span>
              <button
                type="button"
                class="secondary watermark-ack"
                (click)="markAsSeen()"
                [disabled]="acking() || acked()"
              >
                {{ acked() ? 'Seen' : acking() ? 'Marking…' : 'Mark as seen' }}
              </button>
            </div>
          </ng-container>
        </div>
      </section>
    </div>
  `,
  // The journal's vocabulary lives in styles.css under "journal feed" — the two-column split, the
  // feed rows, the episode dividers and the watermark are a set, and keeping them together is what
  // lets the marker's rule line up with the row it sits under. Only the host box is local.
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class JournalPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = this.route.snapshot.paramMap.get('id')!;

  timeline = signal<TimelineResponse | null>(null);
  episodes = signal<Episode[]>([]);
  medications = signal<Medication[]>([]);
  selectedMedicationId = signal<string | null>(null);
  selectedTag = signal<string | null>(null);
  error = signal<string | null>(null);
  chartOpen = signal(prefersChartOpen());

  /** This caregiver's watermark for this patient. Null until the briefing call answers. */
  since = signal<number | null>(null);
  acking = signal(false);
  acked = signal(false);

  entries = computed<TimelineEntry[]>(() => this.timeline()?.entries ?? []);
  /** The patient's temperature bands, straight from the timeline payload to the chart. */
  temperatureRanges = computed(() => this.timeline()?.temperatureRanges ?? []);

  allTags = computed<string[]>(() => {
    const tags = new Set<string>();
    for (const m of this.medications()) {
      for (const t of m.tags) tags.add(t);
    }
    return Array.from(tags).sort();
  });

  private medicationNames = computed(() => new Map(this.medications().map((m) => [m.id, m.name])));

  private rows = computed<FeedRow[]>(() => {
    const units = unitsFor(this.auth.user());
    const names = this.medicationNames();
    const since = this.since();
    return this.entries().map((entry) => ({
      entry,
      author: entry.recordedBy?.displayName ?? null,
      // One formatter for every event list in the app (core/event-display.ts). `display` is the
      // same raw object the single-item GETs return — there is no journal-specific summary shape
      // to keep in sync, and nothing here derives a conclusion from the data (P6).
      text: describeEvent(entry, units, { medicationNames: names, omitDocuments: true }),
      photoFileIds: photoFileIds(entry),
      documents: documentAttachments(entry),
      unseen: since != null && this.loggedAt(entry) >= since,
    }));
  });

  /**
   * The row the watermark line renders *below* — the oldest unseen entry in feed order.
   *
   * "Unseen" is decided on log time (`createdAt`), which is what the ack watermark selects on
   * (api.md → While You Were Asleep: a 2 AM entry written up at 6 AM is unseen by whoever last
   * looked at 5 AM). The feed, though, is ordered by *clinical* time — so an entry can be new but
   * sit below older rows that were already seen. Putting the line under the last unseen row is
   * what makes "read down to the line" cover everything new; the handful of already-seen rows
   * above it are re-read, which costs nothing, whereas a missed row costs the handoff.
   */
  watermarkAfterEntryId = computed<string | null>(() => {
    const unseen = this.rows().filter((r) => r.unseen);
    return unseen.length ? unseen[unseen.length - 1].entry.id : null;
  });

  feed = computed<FeedDay[]>(() => {
    const rows = this.rows();
    const days: FeedDay[] = [];
    let previousFrameKey: string | null = null;

    for (const row of rows) {
      const dayStart = startOfLocalDay(row.entry.timestamp);
      let day = days[days.length - 1];
      if (!day || day.dayStart !== dayStart) {
        day = { dayStart, label: dayLabel(dayStart), items: [] };
        days.push(day);
      }

      // Episode frames drawn from the same start/end spans the chart bands use, so the two agree
      // about where an illness begins and ends. One marker per frame per day — "— Fever, day 3 —"
      // over Wednesday's rows, "day 2" over Tuesday's — rather than one per row (noise) or one per
      // frame (which would leave the older days of a long illness looking unframed, and would have
      // to pick a single day number for a stretch that spans several).
      // Concurrent frames each get their own marker: a patient can be inside a fever episode and
      // an eczema flare at once, and the feed has to say so rather than naming whichever sorted
      // first.
      const frames = this.framesCovering(row.entry.timestamp);
      const frameKey = frames.length ? `${dayStart}:${frames.map((f) => f.episodeId).join('|')}` : '';
      const dividers = frameKey && frameKey !== previousFrameKey ? frames : [];
      previousFrameKey = frameKey;

      day.items.push({ dividers, row });
    }
    return days;
  });

  ngOnInit(): void {
    this.loadMedications();
    this.loadEpisodes();
    this.loadWatermark();
    this.load();
  }

  private loggedAt(entry: TimelineEntry): number {
    // Advisories have no clinical time of their own, so createdAt is all there is either way.
    return (entry.display as any).createdAt ?? entry.timestamp;
  }

  private framesCovering(timestamp: number): EpisodeDivider[] {
    return this.episodes()
      .filter((ep: any) => {
        const start = ep.startedAt;
        if (start == null || timestamp < start) return false;
        return ep.endedAt == null || timestamp <= ep.endedAt;
      })
      .map((ep: any) => ({
        episodeId: ep.id,
        label: `${ep.name}, day ${Math.floor((timestamp - ep.startedAt) / DAY_SECONDS) + 1}`,
      }));
  }

  sinceLabel(since: number): string {
    return `since ${timeAgo(since)}`;
  }

  private loadMedications() {
    this.api.get<Medication[]>('/medications').subscribe({
      next: (res) => this.medications.set(res),
      error: () => this.medications.set([]),
    });
  }

  private loadEpisodes() {
    this.api.get<Episode[]>(`/patients/${this.patientId}/episodes`).subscribe({
      next: (res) => this.episodes.set(res),
      error: () => this.episodes.set([]),
    });
  }

  /**
   * The watermark comes from the What's-New endpoint even though only `since` is read from it.
   * That endpoint *defines* the boundary the ack resets, so taking the number from anywhere else
   * is how the line and the button end up disagreeing about what "seen" meant. A failure here
   * leaves the feed whole and simply renders no marker — the journal is still readable without it.
   */
  private loadWatermark() {
    this.api.get<WhatsNewResponse>(`/patients/${this.patientId}/whats-new`).subscribe({
      next: (res) => this.since.set(res.since),
      error: () => this.since.set(null),
    });
  }

  private load() {
    const params: Record<string, string> = {};
    if (this.selectedMedicationId()) params['medicationId'] = this.selectedMedicationId()!;
    if (this.selectedTag()) params['medicationTag'] = this.selectedTag()!;
    this.api.get<TimelineResponse>(`/patients/${this.patientId}/timeline`, params).subscribe({
      next: (res) => this.timeline.set(res),
      error: (err) => this.error.set(errorText(err, 'Unable to load the journal.')),
    });
  }

  toggleChart() {
    this.chartOpen.set(!this.chartOpen());
  }

  filterByMedication(medicationId: string) {
    this.selectedMedicationId.set(medicationId);
    this.selectedTag.set(null);
    this.load();
  }

  filterByTag(tag: string) {
    this.selectedTag.set(tag);
    this.selectedMedicationId.set(null);
    this.load();
  }

  clearFilters() {
    this.selectedMedicationId.set(null);
    this.selectedTag.set(null);
    this.load();
  }

  /** The only thing that acks. Deliberately not wired to scroll (frontend.md → ack semantics). */
  markAsSeen() {
    if (this.acking() || this.acked()) return;
    this.acking.set(true);
    this.api.post(`/patients/${this.patientId}/whats-new/ack`, {}).subscribe({
      next: () => {
        this.acking.set(false);
        this.acked.set(true);
      },
      error: (err) => {
        this.acking.set(false);
        this.error.set(errorText(err, 'Could not mark as seen.'));
      },
    });
  }

  goToPhotos() {
    this.router.navigate(['/patients', this.patientId, 'photos']);
  }

  goToEpisode(episodeId: string) {
    this.router.navigate(['/episodes', episodeId]);
  }
}

/** Midnight local time for an epoch-seconds instant — the feed's day-group key. */
function startOfLocalDay(epochSeconds: number): number {
  const d = new Date(epochSeconds * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** "Today" / "Yesterday" / "Tue 12 Aug" — relative where a caregiver thinks relatively. */
function dayLabel(dayStart: number): string {
  const today = startOfLocalDay(Math.floor(Date.now() / 1000));
  // An hour before today's midnight is yesterday whatever the clocks did overnight — subtracting a
  // flat 86400 gets the label wrong on the two DST days a year.
  if (dayStart === today) return 'Today';
  if (dayStart === startOfLocalDay(today - 3600)) return 'Yesterday';
  return new Date(dayStart * 1000).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
