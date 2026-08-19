import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CareTeamMember, Episode, Observation, ObservationEntry, ResolvedRange } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { RevisionHistoryComponent } from '../core/revision-history.component';
import { DocumentLinkComponent } from '../timeline/document-link.component';
import { entrySummary, entryTypeLabel, unitsFor } from '../core/event-display';
import { describeRangeText } from '../core/value-bands';
import { errorText } from '../core/error-display';
import { timeAgo } from '../core/relative-time';

/** One entry prepared for rendering — the type label, its phrase, and whatever it attaches. */
interface EntryRow {
  entry: ObservationEntry;
  label: string;
  summary: string;
  /** Set on `photo` entries: the image is the row, the summary is its caption. */
  photoFileId: string | null;
  /** Set on `document` entries: rendered as the journal's labeled attachment link. */
  document: { fileId: string; label: string } | null;
  /** Every range this patient holds for a `lab_result`'s analyte, resolved at `observedAt`. */
  ranges: ResolvedRange[];
}

/** An episode this observation touches, and how it touches it. */
interface EpisodeLink {
  id: string;
  name: string;
  role: 'started' | 'resolved' | 'member';
}

/**
 * Read-only observation detail (frontend.md → "Observation & intervention detail").
 *
 * The gap this closes: entry metadata was write-only. The entry forms collect a photo's body
 * location, side and size, a lesion's three dimensions, a temperature's method — and then the only
 * surface that ever showed any of it was the journal's one-line summary. This is where what was
 * recorded is read back.
 *
 * **View only.** No edit, no delete, no re-linking; correcting an entry is a later change. The one
 * thing on this page that touches the correction machinery is the History section, which reads the
 * revisions the existing `PATCH` already captures.
 *
 * Values render in the *reader's* unit preference, the entry provenance line names the *recorder's*
 * — two different facts, and printing only one of them would imply a conversion that never
 * happened (api.md → Observations: `unitPreferenceAtEntry` is provenance, not an instruction).
 */
@Component({
  selector: 'app-observation-detail-page',
  standalone: true,
  imports: [CommonModule, PhotoThumbnailComponent, DocumentLinkComponent, RevisionHistoryComponent],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="backToJournal()">&larr; Journal</button>

      <p class="error" *ngIf="error()">{{ error() }}</p>

      <ng-container *ngIf="observation() as obs">
        <div class="card-header">
          <div>
            <h1>Observation</h1>
            <p class="muted">
              {{ obs.observedAt * 1000 | date: 'medium' }}
              <span class="small">· {{ ago(obs.observedAt) }}</span>
            </p>
          </div>
        </div>

        <p class="obs-text" *ngIf="obs.text">{{ obs.text }}</p>

        <!-- Attribution and log time. When it was written down is a different fact from when it
             was observed — a 2 AM reading written up at 6 AM — and the journal's since-you-last-
             looked marker turns on exactly that gap. -->
        <p class="muted small attribution">
          Recorded by {{ recordedByName() ?? 'Unknown caregiver' }}
          <span *ngIf="obs.createdAt"> · logged {{ obs.createdAt * 1000 | date: 'medium' }}</span>
        </p>
        <p class="muted small" *ngIf="enteredInLabel() as entered">Entered in {{ entered }}</p>

        <section>
          <h2>Entries</h2>
          <ul class="row-list" *ngIf="rows().length; else noEntries">
            <li *ngFor="let row of rows()" class="entry-row">
              <span class="pill pill-neutral entry-type">{{ row.label }}</span>
              <div class="entry-body">
                <app-photo-thumbnail
                  *ngIf="row.photoFileId"
                  [fileId]="row.photoFileId"
                  [large]="true"
                ></app-photo-thumbnail>
                <div class="entry-summary">{{ row.summary }}</div>
                <app-document-link
                  *ngIf="row.document"
                  [fileId]="row.document.fileId"
                  [label]="row.document.label"
                ></app-document-link>
                <!-- The standards this value is read against, resolved at observedAt. The page
                     never computes a flag of its own — only the report's printed one shows. -->
                <div class="ranges" *ngIf="row.ranges.length">
                  <span class="pill pill-neutral" *ngFor="let r of row.ranges">
                    {{ r.label }} {{ range(r) }}
                  </span>
                </div>
              </div>
            </li>
          </ul>
          <ng-template #noEntries>
            <p class="muted">This observation has no entries.</p>
          </ng-template>
        </section>

        <section *ngIf="episodeLinks().length">
          <h2>Episodes</h2>
          <div class="episode-links">
            <button type="button" class="pill episode-link" *ngFor="let ep of episodeLinks()" (click)="goToEpisode(ep.id)">
              {{ ep.name }}
              <span class="muted small" *ngIf="ep.role !== 'member'">· {{ ep.role }} by this entry</span>
            </button>
          </div>
        </section>

        <section>
          <h2>History</h2>
          <app-revision-history entityType="observation" [entityId]="obs.id"></app-revision-history>
          <p class="muted small">Corrections are recorded here; this page does not edit.</p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .link {
        align-self: flex-start;
      }
      .muted {
        margin: 0;
      }
      .obs-text {
        margin: 0;
        font-size: 1.05rem;
      }
      .attribution {
        margin-top: -0.4rem;
      }
      section {
        border-top: 1px solid var(--border);
        padding-top: 0.85rem;
      }
      .entry-row {
        align-items: flex-start;
        gap: 0.65rem;
      }
      /* Fixed column so the phrases line up down the list — the page is read by scanning them. */
      .entry-type {
        flex: 0 0 auto;
        min-width: 8.5rem;
        text-transform: none;
      }
      .entry-body {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
      }
      .entry-summary {
        word-break: break-word;
      }
      .ranges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .episode-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .episode-link {
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
        color: var(--accent-soft);
      }
      @media (max-width: 560px) {
        .entry-row {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class ObservationDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  observationId = this.route.snapshot.paramMap.get('id') ?? '';
  observation = signal<Observation | null>(null);
  episodes = signal<Episode[]>([]);
  careTeam = signal<CareTeamMember[]>([]);
  error = signal<string | null>(null);

  private readonly units = computed(() => unitsFor(this.auth.user()));

  /**
   * Attribution resolves through the patient's care team: the observation carries only
   * `recordedByUserId`, and the timeline's resolved `recordedBy` is not on this payload. A
   * caregiver who has since left the team is no longer in that list, so this returns null and the
   * template says "Unknown caregiver" rather than printing a raw uuid or guessing a name (P6).
   */
  recordedByName = computed<string | null>(() => {
    const obs = this.observation();
    if (!obs) return null;
    return this.careTeam().find((m) => m.user.id === obs.recordedByUserId)?.user.displayName ?? null;
  });

  /** The units the *recorder* had on screen — provenance, never a conversion instruction. */
  enteredInLabel = computed<string | null>(() => {
    const pref = this.observation()?.unitPreferenceAtEntry;
    if (!pref) return null;
    return [`°${pref.temp}`, pref.weight, pref.length].join(' · ');
  });

  rows = computed<EntryRow[]>(() => {
    const units = this.units();
    return (this.observation()?.entries ?? []).map((entry) => {
      const metadata: any = entry.metadata ?? {};
      return {
        entry,
        label: entryTypeLabel(entry.type),
        // One formatter for every event surface in the app (core/event-display.ts) — a detail page
        // with its own phrasing is how "Temp 101.2 °F (oral)" starts meaning two different things.
        summary: entrySummary(entry, units),
        photoFileId: entry.type === 'photo' && metadata.fileId ? (metadata.fileId as string) : null,
        document:
          entry.type === 'document' && metadata.fileId
            ? {
                fileId: metadata.fileId as string,
                label: (metadata.label ?? metadata.originalName ?? 'document') as string,
              }
            : null,
        ranges: entry.type === 'lab_result' ? entry.labContext?.ranges ?? [] : [],
      };
    });
  });

  /**
   * Every episode this observation touches, labeled by how. `episodeIds` and `resolvesEpisodeIds`
   * are disjoint on read — the pivot writes a separate row for a resolving link and `getById`
   * derives the two lists from those rows (CLAUDE.md → Episode model) — so the chips are their
   * union, not just the membership list.
   */
  episodeLinks = computed<EpisodeLink[]>(() => {
    const obs = this.observation();
    if (!obs) return [];
    const resolves = new Set(obs.resolvesEpisodeIds ?? []);
    const ids = Array.from(new Set([...(obs.episodeIds ?? []), ...resolves]));
    const byId = new Map(this.episodes().map((ep) => [ep.id, ep]));
    return ids.map((id) => {
      const ep = byId.get(id);
      const started = ep?.startedAtType === 'observation' && ep?.startedAtId === obs.id;
      return {
        id,
        name: ep?.name ?? 'Episode',
        role: resolves.has(id) ? 'resolved' : started ? 'started' : 'member',
      };
    });
  });

  ngOnInit(): void {
    if (!this.observationId) return;
    this.load();
  }

  private load() {
    this.api.get<Observation>(`/observations/${this.observationId}`).subscribe({
      next: (obs) => {
        this.observation.set(obs);
        this.loadContext(obs.patientId);
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load this observation.')),
    });
  }

  /**
   * Episode names and caregiver names, both best-effort: neither is the record, and a failure in
   * either must not blank the entries this page exists to show. The chips fall back to "Episode"
   * and the attribution to "Unknown caregiver", which are honest rather than empty.
   */
  private loadContext(patientId: string) {
    this.api.get<Episode[]>(`/patients/${patientId}/episodes`).subscribe({
      next: (eps) => this.episodes.set(eps),
      error: () => this.episodes.set([]),
    });
    this.api.get<CareTeamMember[]>(`/patients/${patientId}/care-team`).subscribe({
      next: (members) => this.careTeam.set(members),
      error: () => this.careTeam.set([]),
    });
  }

  ago(ts: number): string {
    return timeAgo(ts);
  }

  range(r: ResolvedRange): string {
    return describeRangeText(r);
  }

  goToEpisode(episodeId: string) {
    this.router.navigate(['/episodes', episodeId]);
  }

  backToJournal() {
    const obs = this.observation();
    this.router.navigate(obs ? ['/patients', obs.patientId, 'journal'] : ['/dashboard']);
  }
}
