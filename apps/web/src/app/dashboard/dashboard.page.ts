import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { nextDoseLabel, timeAgo, timeUntil, relativeTime } from '../core/relative-time';
import { convertTemp, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { DashboardPayload, DashboardTemperaturePoint, PatientAccentColor, TemperatureMethod } from '@salud/shared/types';
import { DisplayBand, PlottedBand, bandedDomain, describeBand, plotBands, toDisplayBands } from '../core/value-bands';

// The sparkline canvas. Small on purpose: it is a glance at the shape of the last two nights, not
// the timeline's chart. The x-domain is the fixed 48-hour window rather than the patient's own
// readings, so two sick cards side by side are actually comparable — a patient measured twice and
// one measured nine times must not draw the same width of curve at different time scales.
const SPARK_WIDTH = 180;
const SPARK_HEIGHT = 44;
const SPARK_PAD = 5;
const SPARK_WINDOW_SECONDS = 48 * 3600;
// A floor on the y-domain, in °C. Without it a night that ran 38.5–38.7 draws the same dramatic
// swing as one that ran 37.0–40.0, which is the chart editorializing about data it was only asked
// to plot (P6).
const SPARK_MIN_SPAN_C = 1.5;

interface SickMedication {
  medicationId: string;
  medicationName: string;
  lastDoseAt: number;
  nextAllowedAt: number | null;
  isAtypicalLastDose: boolean;
  /** The repeat-dose prefill, carried by both payload arrays (api.md → GET /api/dashboard). */
  lastEmbodimentId: string | null;
  lastEmbodimentLabel: string | null;
  lastAmountMg: number | null;
  lastAmountMl: number | null;
}

interface SickEpisode {
  episodeId: string;
  name: string;
  dayCount: number | null;
}

interface SparkPoint {
  x: number;
  y: number;
  valueShown: number;
  timestamp: number;
}

interface SickCard {
  patientId: string;
  patientName: string;
  accentColor: PatientAccentColor;
  episodes: SickEpisode[];
  medications: SickMedication[];
  points: SparkPoint[];
  polyline: string;
  latest: SparkPoint | null;
  /** The patient's own temperature bands, shaded behind the curve. Empty when none are recorded. */
  bands: PlottedBand[];
  /** The y-domain's edges, labelled so the curve's amplitude is actually readable. */
  scaleHigh: number | null;
  scaleLow: number | null;
  /** The soonest moment this patient needs something done — the card sort key. `null` sorts last. */
  nextActionableAt: number | null;
  /** Seeds the Temp quick action's method select — a per-patient habit, editable on the form. */
  lastTempMethod: TemperatureMethod | null;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent],
  template: `
    <div class="card">
      <h1>Home</h1>
      <!-- Logging only. The catalogs and "New schedule" moved to /manage: they are monthly setup
           tasks, and they were competing for the most urgent screen in the app (frontend.md →
           "Information architecture (v2)" → Home). -->
      <div class="actions">
        <button class="primary" type="button" (click)="goToNewObservation()">Create observation</button>
        <button class="secondary" type="button" (click)="goToNewIntervention()">Log intervention</button>
      </div>

      <div class="advisories" *ngIf="dashboard()?.unacknowledgedAdvisories?.length">
        <h2>Needs attention</h2>
        <app-advisory-banner
          *ngFor="let a of dashboard()!.unacknowledgedAdvisories"
          [advisory]="a"
        ></app-advisory-banner>
      </div>

      <!-- ==================== SICK MODE ==================== -->

      <!-- The night board. Two or more sick patients is the concurrent-illness case the product is
           designed around, and this is the whole point of it: who can have what, when, in one
           glance, without scrolling between cards. Pure arithmetic, no interpretation (P6). -->
      <section class="night-board-section" *ngIf="showNightBoard()">
        <h2>Who can have what</h2>
        <div class="night-board">
          <div class="nb-row accent-rail" *ngFor="let c of sickCards()" [ngClass]="accentClass(c.accentColor)">
            <div class="nb-patient"><span class="accent-dot"></span>{{ c.patientName }}</div>
            <div class="nb-meds">
              <p class="muted small" *ngIf="!c.medications.length">No doses logged.</p>
              <!-- Countdown last, so every row's number ends at the same right edge and the board
                   reads as one column of times rather than a ragged list. -->
              <div class="nb-med" *ngFor="let m of c.medications">
                <span class="nb-med-name">{{ m.medicationName }}</span>
                <span class="pill pill-danger" *ngIf="m.isAtypicalLastDose">atypical</span>
                <span class="nb-count" [class.ready]="doseReady(m.nextAllowedAt)">{{ countdown(m.nextAllowedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="sick-cards" *ngIf="sickCards().length">
        <ul class="sick-list">
          <li class="sick-card accent-rail" *ngFor="let c of sickCards()" [ngClass]="accentClass(c.accentColor)">
            <div class="sick-head">
              <strong class="sick-name"><span class="accent-dot"></span>{{ c.patientName }}</strong>
              <button
                type="button"
                class="episode-pill"
                *ngFor="let ep of c.episodes"
                (click)="goToEpisode(ep.episodeId)"
              >
                {{ ep.name }}<span *ngIf="ep.dayCount"> · day {{ ep.dayCount }}</span>
              </button>
            </div>

            <!-- The countdown is the hero, not a suffix: it is the answer to "did I already give
                 Tylenol?" (product.md → origin story), and at 3 AM it has to be readable before
                 anything else on the card is. -->
            <p class="muted small" *ngIf="!c.medications.length">Nothing given in the last 24 hours.</p>
            <div class="dose-block" *ngFor="let m of c.medications">
              <div class="dose-hero" [class.ready]="doseReady(m.nextAllowedAt)">{{ countdown(m.nextAllowedAt) }}</div>
              <div class="dose-meta">
                <span class="med-name">{{ m.medicationName }}</span>
                <span class="pill pill-danger" *ngIf="m.isAtypicalLastDose">atypical</span>
                <span class="ago">last dose {{ ago(m.lastDoseAt) }}</span>
                <!-- "Same as last time", labeled with exactly what it will prefill — at 3 AM the
                     button has to say what it is going to do. One button per active medication:
                     the tylenol+ibuprofen alternation is the design case (frontend.md → Home). -->
                <button type="button" class="secondary small" (click)="repeatDose(c.patientId, m)">
                  ↻ {{ repeatLabel(m) }}
                </button>
              </div>
            </div>

            <!-- The curve is only readable as a measurement if it says what it is measured
                 against: the scale labels answer "how high is it", the shaded bands answer "is that
                 high". The bands are the household's own recorded ranges — the app never draws a
                 normal range of its own invention (frontend.md → Home). -->
            <div class="spark-wrap">
              <div class="spark-plot" *ngIf="c.points.length; else noTemps">
                <svg class="spark" [attr.viewBox]="'0 0 ' + sparkWidth + ' ' + sparkHeight" aria-hidden="true">
                  <g *ngFor="let b of c.bands">
                    <rect
                      [attr.x]="0"
                      [attr.y]="b.y"
                      [attr.width]="sparkWidth"
                      [attr.height]="b.height"
                      [class.spark-band]="b.reference"
                      [class.spark-band-custom]="!b.reference"
                    >
                      <title>{{ bandTitle(b) }}</title>
                    </rect>
                    <!-- The bound itself. "Above this line" is the question a fever chart is
                         actually asked, and a soft fill alone leaves the threshold approximate. -->
                    <line
                      *ngIf="b.highY !== null"
                      [attr.x1]="0" [attr.x2]="sparkWidth" [attr.y1]="b.highY" [attr.y2]="b.highY"
                      class="spark-band-edge"
                    />
                    <line
                      *ngIf="b.lowY !== null"
                      [attr.x1]="0" [attr.x2]="sparkWidth" [attr.y1]="b.lowY" [attr.y2]="b.lowY"
                      class="spark-band-edge"
                    />
                  </g>
                  <polyline *ngIf="c.points.length > 1" [attr.points]="c.polyline" class="spark-line" />
                  <circle *ngFor="let p of c.points" [attr.cx]="p.x" [attr.cy]="p.y" r="2" class="spark-dot" />
                </svg>
                <div class="spark-scale" *ngIf="c.scaleHigh !== null">
                  <span>{{ c.scaleHigh }}</span>
                  <span>{{ c.scaleLow }}</span>
                </div>
              </div>
              <ng-template #noTemps>
                <p class="muted small">No temperature logged in the last 48 hours.</p>
              </ng-template>
              <span class="spark-latest" *ngIf="c.latest">
                {{ c.latest.valueShown }} °{{ tempUnit() }} · {{ ago(c.latest.timestamp) }}
              </span>
            </div>
            <!-- Named in words as well as shaded: the colour alone doesn't say 36.1–37.2, and at
                 3 AM the number is what gets repeated down a phone to a nurse. -->
            <p class="spark-legend small muted" *ngIf="c.bands.length">
              <span *ngFor="let b of c.bands; let i = index">{{ i ? ' · ' : '' }}{{ bandTitle(b) }}</span>
            </p>

            <div class="quick-actions">
              <button type="button" class="secondary small" (click)="quickTemp(c)">Temp</button>
              <button type="button" class="secondary small" (click)="quickDose(c.patientId)">Dose</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ==================== SHARED / QUIET CONTENT ====================
           In sick mode everything below renders under the sick cards and never interleaves with
           them (frontend.md → Home). -->

      <section class="last-doses" *ngIf="quietLastDoses().length">
        <h2>Last doses</h2>
        <ul class="dose-list">
          <li *ngFor="let p of quietLastDoses()" [ngClass]="accentClass(p.accentColor)">
            <div class="row-main">
              <strong><span class="accent-dot"></span>{{ p.patientName }}</strong>
            </div>

            <!-- The confident negative. At 3 AM the negative *is* the answer; a hidden row is
                 ambiguous between "nobody gave anything" and "the app doesn't know". -->
            <p class="muted small" *ngIf="!p.doses.length">Nothing given in the last 24 hours.</p>

            <div class="dose-row" *ngFor="let d of p.doses">
              <span class="med-name">{{ d.medicationName }}</span>
              <span class="pill pill-danger" *ngIf="d.isAtypicalLastDose">atypical</span>
              <span class="ago">{{ ago(d.lastDoseAt) }}</span>
              <span class="next" [class.ready]="doseReady(d.nextAllowedAt)" *ngIf="nextDose(d.nextAllowedAt) as label">{{
                label
              }}</span>
            </div>
          </li>
        </ul>
      </section>

      <section *ngIf="whatsNewSummaries().length">
        <h2>While you were asleep</h2>
        <ul class="schedule-list">
          <li *ngFor="let w of whatsNewSummaries()" [ngClass]="accentClass(w.accentColor)">
            <button type="button" class="row-link" (click)="goToJournal(w.patientId)">
              <div class="row-main">
                <strong><span class="accent-dot"></span>{{ w.patientName }}</strong>
              </div>
              <!-- Every clause is conditional: a patient with no new events but a fired advisory
                   should read "1 advisory fired", not "0 new events · 1 advisory fired". -->
              <div class="muted small">
                <span *ngIf="w.eventCount">{{ w.eventCount }} new event{{ w.eventCount === 1 ? '' : 's' }}</span>
                <span *ngIf="w.advisoryCount"
                  >{{ w.eventCount ? ' · ' : '' }}{{ w.advisoryCount }} advisor{{
                    w.advisoryCount === 1 ? 'y' : 'ies'
                  }}
                  fired</span
                >
                <span *ngIf="w.nowDueCount"
                  >{{ w.eventCount || w.advisoryCount ? ' · ' : '' }}{{ w.nowDueCount }} due now</span
                >
              </div>
            </button>
          </li>
        </ul>
      </section>

      <section *ngIf="dashboard()?.upcomingSchedules?.length">
        <h2>Upcoming &amp; overdue</h2>
        <ul class="schedule-list">
          <li *ngFor="let s of dashboard()!.upcomingSchedules" [class.overdue]="s.overdue">
            <button type="button" class="row-link" (click)="goToSchedule(s.scheduleId)">
              <div class="row-main">
                <strong>{{ s.label }}</strong>
                <span class="pill pill-danger" *ngIf="s.overdue">overdue</span>
              </div>
              <div class="muted small" *ngIf="s.nextDueAt">
                Due {{ until(s.nextDueAt) }}
              </div>
            </button>
            <button type="button" class="secondary small" (click)="logDose(s.scheduleId)">Log dose</button>
          </li>
        </ul>
      </section>

      <!-- Quiet mode only: in sick mode these same episodes are the sick cards above, and rendering
           both would say the same thing twice on the screen with the least room to spare. -->
      <section *ngIf="!isSickMode() && dashboard()?.activeEpisodes?.length">
        <h2>Active episodes</h2>
        <ul class="episode-list">
          <li *ngFor="let ep of dashboard()!.activeEpisodes">
            <button type="button" class="episode-card" (click)="goToEpisode(ep.episodeId)">
              <div class="row-main">
                <strong>{{ ep.name }}</strong>
                <span class="muted">— {{ ep.patientName }}</span>
              </div>
              <div class="muted small" *ngIf="ep.lastObservationSummary">
                Last observed {{ ago(ep.lastObservationSummary.observedAt) }}
                ({{ ep.lastObservationSummary.entries[0]?.type }})
              </div>
            </button>
          </li>
        </ul>
      </section>

      <section *ngIf="dashboard()?.shoppingList?.length">
        <h2>Shopping list</h2>
        <ul class="shopping-list">
          <li *ngFor="let item of dashboard()!.shoppingList">
            <span>{{ item.medicationName }} — {{ item.label }}</span>
            <button type="button" class="secondary small" (click)="restock(item.embodimentId)">Restocked</button>
          </li>
        </ul>
      </section>

      <p
        class="muted"
        *ngIf="
          dashboard() &&
          !sickCards().length &&
          !quietLastDoses().length &&
          !whatsNewSummaries().length &&
          !dashboard()!.upcomingSchedules.length &&
          !dashboard()!.shoppingList.length &&
          !dashboard()!.unacknowledgedAdvisories.length
        "
      >
        Nothing needs attention right now.
      </p>

      <!-- An unreachable API must say so. A blank home screen reads as "nothing has been logged",
           which is the worst possible answer on the screen used to decide whether a dose was
           already given (frontend.md → Errors & failure messages). -->
      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .card {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .actions {
        justify-content: flex-start;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .secondary.small {
        padding: 0.4rem 0.7rem;
        font-size: 0.85rem;
      }
      section {
        border-top: 1px solid var(--border);
        padding-top: 0.85rem;
      }
      .advisories {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .schedule-list,
      .episode-list,
      .shopping-list,
      .dose-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .dose-list li {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .dose-row {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .med-name {
        font-weight: 600;
      }
      .ago {
        color: var(--text-muted);
      }
      .next {
        font-size: 0.85rem;
        color: var(--text-muted);
      }
      .next.ready {
        color: var(--success-text);
      }
      .schedule-list li {
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-input);
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .schedule-list li.overdue {
        border-color: var(--danger-border);
        background: var(--danger-bg);
      }
      .row-link {
        flex: 1;
        text-align: left;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0;
      }
      .row-main {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      /* The strip and what's-new rows name a patient too, so they carry the dot — the association
         between a color and a child is only learnable if it is the same everywhere. */
      .row-main strong {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .episode-card {
        width: 100%;
        text-align: left;
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-input);
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .episode-card:hover {
        background: var(--surface-raised);
      }
      .shopping-list li {
        padding: 0.5rem 0.75rem;
        border-radius: var(--radius-input);
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .sick-cards {
        border-top: none;
        padding-top: 0;
      }
      .sick-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
    `,
  ],
})
export class DashboardPage implements OnInit {
  private readonly router = inject(Router);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);

  dashboard = signal<DashboardPayload | null>(null);
  error = signal<string | null>(null);

  /**
   * One clock read per load, shared by every time label and by the card ordering.
   *
   * Reading `Date.now()` inside the render methods instead — which is what this page used to do —
   * makes rendering impure: Angular's dev-mode `checkNoChanges` pass runs immediately after the
   * first, and a second boundary falling between the two flips "in 2h 30m" to "in 2h 29m" and
   * throws NG0100. Production skips that pass, so it surfaced as an intermittently red test rather
   * than a visible bug, but the impurity was real either way — the same render was not reproducible
   * from the same state.
   *
   * Snapshotting also makes the no-live-ticker rule this page already claimed actually true: times
   * advance when the payload is refetched (open, restock, log-and-return), which is exactly the
   * "the dashboard is opened fresh in the case that matters" behavior frontend.md describes.
   */
  private nowTs = signal(Math.floor(Date.now() / 1000));

  sparkWidth = SPARK_WIDTH;
  sparkHeight = SPARK_HEIGHT;

  tempUnit = computed(() => unitsFor(this.auth.user()).temp);

  /**
   * The bimodal switch (frontend.md → "Information architecture (v2)" → Home). One sick card per
   * patient with an active episode; the household's shape decides the page's shape, not a fixed
   * section stack.
   *
   * Ordering, `nextActionableAt` and the sparkline geometry are all computed once per payload, so
   * they read the clock at load rather than on every change-detection pass. That is deliberate and
   * matches the countdowns' existing no-live-ticker rule: this page is opened fresh in the case
   * that matters. The *labels* stay method calls, so they do refresh on any interaction.
   */
  sickCards = computed<SickCard[]>(() => {
    const payload = this.dashboard();
    if (!payload) return [];
    const nowSec = this.nowTs();

    const byPatient = new Map<string, SickCard>();
    for (const ep of payload.activeEpisodes) {
      const card =
        byPatient.get(ep.patientId) ??
        ({
          patientId: ep.patientId,
          patientName: ep.patientName,
          accentColor: ep.accentColor,
          episodes: [],
          medications: [],
          points: [],
          polyline: '',
          latest: null,
          bands: [],
          scaleHigh: null,
          scaleLow: null,
          nextActionableAt: null,
          lastTempMethod: null,
        } as SickCard);
      card.episodes.push({
        episodeId: ep.episodeId,
        name: ep.name,
        dayCount: ep.startedAt == null ? null : Math.floor((nowSec - ep.startedAt) / 86400) + 1,
      });
      byPatient.set(ep.patientId, card);
    }
    if (!byPatient.size) return [];

    // "Active medication" is the union of two deliberately different scopes, and it has to be both:
    // `activeEpisodes[].medications` is episode-scoped (it reaches back past 24h but only sees
    // doses attached to an episode), while `lastDoses` is patient-scoped and episode-agnostic (the
    // 3 AM dose logged with no episode — the common case, and the reason `lastDoses` exists at
    // all). Dropping either one drops doses a caregiver would then re-give.
    const merge = (card: SickCard, m: SickMedication) => {
      const existing = card.medications.find((x) => x.medicationId === m.medicationId);
      if (!existing) {
        card.medications.push(m);
        return;
      }
      if (m.lastDoseAt > existing.lastDoseAt) Object.assign(existing, m);
    };
    for (const ep of payload.activeEpisodes) {
      const card = byPatient.get(ep.patientId);
      if (!card) continue;
      for (const m of ep.medications) merge(card, { ...m });
    }
    for (const row of payload.lastDoses) {
      const card = byPatient.get(row.patientId);
      if (!card) continue;
      for (const d of row.doses) merge(card, { ...d });
    }

    const temperaturesByPatient = new Map(payload.recentTemperatures?.map((r) => [r.patientId, r.points]) ?? []);
    const methodByPatient = new Map(payload.recentTemperatures?.map((r) => [r.patientId, r.lastMethod]) ?? []);
    const bandsByPatient = new Map(payload.temperatureRanges?.map((r) => [r.patientId, r.ranges]) ?? []);
    const displayUnit = unitsFor(this.auth.user()).temp;

    for (const card of byPatient.values()) {
      // Soonest-actionable first inside the card too, so the hero countdown at the top of a card is
      // the next thing that card is asking for.
      card.medications.sort((a, b) => nullsLast(a.nextAllowedAt) - nullsLast(b.nextAllowedAt) || b.lastDoseAt - a.lastDoseAt);

      const scheduleTimes = this.dashboard()!
        .upcomingSchedules.filter((s) => s.patientId === card.patientId)
        .map((s) => s.nextDueAt);
      const candidates = [...card.medications.map((m) => m.nextAllowedAt), ...scheduleTimes].filter(
        (t): t is number => t != null,
      );
      card.nextActionableAt = candidates.length ? Math.min(...candidates) : null;

      const bands = toDisplayBands(bandsByPatient.get(card.patientId) ?? [], displayUnit);
      const drawn = this.plotSparkline(
        temperaturesByPatient.get(card.patientId) ?? [],
        nowSec,
        displayUnit,
        bands,
      );
      card.points = drawn.points;
      card.polyline = drawn.points.map((p) => `${p.x},${p.y}`).join(' ');
      card.latest = drawn.points.length ? drawn.points[drawn.points.length - 1] : null;
      card.bands = drawn.bands;
      card.scaleHigh = drawn.domain ? round1(drawn.domain.hi) : null;
      card.scaleLow = drawn.domain ? round1(drawn.domain.lo) : null;
      card.lastTempMethod = methodByPatient.get(card.patientId) ?? null;
    }

    // The top of the screen is the next thing to do — a "can give now" (a next-allowed already
    // elapsed) sorts above a countdown still running, because a past timestamp is a smaller number.
    return Array.from(byPatient.values()).sort(
      (a, b) => nullsLast(a.nextActionableAt) - nullsLast(b.nextActionableAt) || a.patientName.localeCompare(b.patientName),
    );
  });

  isSickMode = computed(() => this.sickCards().length > 0);

  /** The night board is for the concurrent-illness case only — one sick child is just a card. */
  showNightBoard = computed(() => this.sickCards().length >= 2);

  /**
   * In sick mode the strip carries the quiet patients only: a sick patient's doses are already the
   * hero of their own card above, and repeating them here would be the same answer twice on the
   * screen with the least room to spare. Every quiet patient still gets their row — including the
   * explicit "Nothing given in the last 24 hours", which is itself the answer.
   */
  quietLastDoses = computed(() => {
    const rows = this.dashboard()?.lastDoses ?? [];
    if (!this.isSickMode()) return rows;
    const sick = new Set(this.sickCards().map((c) => c.patientId));
    return rows.filter((r) => !sick.has(r.patientId));
  });

  // The server emits a row per accessible patient, all-zero rows included; hiding the empty ones is
  // this page's call (frontend.md → While You Were Asleep). Nothing changed since you last looked is
  // genuinely nothing — unlike the Last doses strip, whose empty state is itself the answer.
  whatsNewSummaries = computed(() =>
    (this.dashboard()?.whatsNew ?? []).filter((w) => w.eventCount || w.advisoryCount || w.nowDueCount),
  );

  ngOnInit(): void {
    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.load(),
        error: () => this.auth.logout(),
      });
    } else {
      this.load();
    }
  }

  // One request for the whole page — including the sick cards' sparklines, which is why
  // `recentTemperatures` rides along on this payload instead of being a timeline query per sick
  // patient (api.md → GET /api/dashboard).
  private load() {
    this.api.get<DashboardPayload>('/dashboard').subscribe({
      next: (res) => {
        // Before the payload, so the computeds that read both see a clock at least as new as the
        // data rather than one from the previous load.
        this.nowTs.set(Math.floor(Date.now() / 1000));
        this.dashboard.set(res);
        this.error.set(null);
      },
      error: (err) => {
        this.dashboard.set(null);
        this.error.set(errorText(err, 'Could not load the dashboard.'));
      },
    });
  }

  /**
   * Geometry for one card's sparkline: the readings, the patient's bands behind them, and the
   * y-domain both share.
   *
   * The bands join the domain rather than being clipped to the readings' own range — a band the
   * night never reached is precisely the reference a caregiver is checking against, and scaling it
   * off the picture would answer "is that high" with silence (frontend.md → Home). The x-domain
   * stays the fixed 48-hour window, so two cards side by side remain comparable.
   */
  private plotSparkline(
    points: DashboardTemperaturePoint[],
    nowSec: number,
    displayUnit: 'C' | 'F',
    bands: DisplayBand[],
  ): { points: SparkPoint[]; bands: PlottedBand[]; domain: { lo: number; hi: number } | null } {
    if (!points.length) return { points: [], bands: [], domain: null };
    const shown = points.map((p) => ({ timestamp: p.timestamp, valueShown: convertTemp(p.valueC, 'C', displayUnit) }));
    const minSpan = displayUnit === 'F' ? (SPARK_MIN_SPAN_C * 9) / 5 : SPARK_MIN_SPAN_C;
    const domain = bandedDomain(shown.map((p) => p.valueShown), bands, minSpan);
    if (!domain) return { points: [], bands: [], domain: null };

    const usableW = SPARK_WIDTH - 2 * SPARK_PAD;
    const usableH = SPARK_HEIGHT - 2 * SPARK_PAD;
    const from = nowSec - SPARK_WINDOW_SECONDS;
    const span = domain.hi - domain.lo;
    // A single reading, or a flat run, sits on the middle line rather than at an arbitrary edge.
    const yFor = (value: number) =>
      SPARK_PAD + usableH - (span === 0 ? 0.5 : (value - domain.lo) / span) * usableH;

    return {
      points: shown.map((p) => ({
        ...p,
        x: SPARK_PAD + clamp01((p.timestamp - from) / SPARK_WINDOW_SECONDS) * usableW,
        y: yFor(p.valueShown),
      })),
      bands: plotBands(bands, domain, yFor),
      domain,
    };
  }

  /** The band's own words, for the shaded region's tooltip. */
  bandTitle(band: DisplayBand): string {
    return describeBand(band, ` °${this.tempUnit()}`);
  }

  // The since-you-last-looked marker lives inside the journal feed now, so a summary row deep-links
  // to the narrative rather than to a separate briefing page (frontend.md → "Information
  // architecture (v2)" → Journal). The row's own rendering — accent colour included — is unchanged.
  goToJournal(patientId: string) {
    this.router.navigate(['/patients', patientId, 'journal']);
  }

  goToNewObservation() {
    this.router.navigate(['/observations/new']);
  }

  goToNewIntervention() {
    this.router.navigate(['/interventions/new']);
  }

  // Patient-scoped quick actions off a sick card, handing off to the same compact entry forms
  // Quick Log's verbs use — one form codepath, no parallel implementation (frontend.md → Quick Log).

  /**
   * One tap to the number: the compact temperature form, with the method preselected from this
   * patient's own last known-method reading (`lastMethod` on the payload's `recentTemperatures`).
   * The select stays on the form and editable — a prefill, never an assertion.
   */
  quickTemp(card: SickCard) {
    const queryParams: Record<string, string> = {
      patientId: card.patientId,
      entryType: 'temperature',
      compact: '1',
    };
    if (card.lastTempMethod) queryParams['method'] = card.lastTempMethod;
    this.router.navigate(['/observations/new'], { queryParams });
  }

  quickDose(patientId: string) {
    this.router.navigate(['/interventions/new'], {
      queryParams: { patientId, type: 'medication_dose', compact: '1' },
    });
  }

  /**
   * "Same as last time" from the card — the exact prefill contract Quick Log's recents cards hand
   * the dose form (quick-log-sheet.component.ts → chooseRecent). A prefill and nothing more:
   * dose-checks still run there, guidance cards still render, advisory banners and the danger
   * interstitial still fire, and the caregiver still reviews before "Save for ⟨name⟩".
   *
   * Per-patient by construction: the medication row lives inside this patient's card, so a
   * sibling's dose can never seed it (frontend.md → "Patient identity").
   */
  repeatDose(patientId: string, m: SickMedication) {
    const queryParams: Record<string, string> = {
      patientId,
      type: 'medication_dose',
      compact: '1',
      medicationId: m.medicationId,
    };
    if (m.lastEmbodimentId) queryParams['embodimentId'] = m.lastEmbodimentId;
    if (m.lastAmountMg != null) queryParams['amountMg'] = String(m.lastAmountMg);
    if (m.lastAmountMl != null) queryParams['amountMl'] = String(m.lastAmountMl);
    this.router.navigate(['/interventions/new'], { queryParams });
  }

  /** The button says what it will prefill — "160 mg · Children's syrup" — or falls back to words. */
  repeatLabel(m: SickMedication): string {
    const parts: string[] = [];
    if (m.lastAmountMg != null) parts.push(`${m.lastAmountMg} mg`);
    if (m.lastAmountMl != null) parts.push(`${m.lastAmountMl} mL`);
    if (m.lastEmbodimentLabel) parts.push(m.lastEmbodimentLabel);
    return parts.length ? parts.join(' · ') : 'Repeat dose';
  }

  goToSchedule(scheduleId: string) {
    this.router.navigate(['/schedules', scheduleId]);
  }

  goToEpisode(episodeId: string) {
    this.router.navigate(['/episodes', episodeId]);
  }

  logDose(scheduleId: string) {
    this.router.navigate(['/interventions/new'], { queryParams: { scheduleId } });
  }

  restock(embodimentId: string) {
    this.api.post(`/embodiments/${embodimentId}/restock`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(errorText(err, 'Could not mark that as restocked.')),
    });
  }

  // Thin wrappers around core/relative-time.ts, every one of them pinned to `nowTs` rather than to
  // the wall clock — see that field for why a render that reads the clock twice is a defect and not
  // just a flaky test (frontend.md → "Times on this page are relative, not absolute").
  ago(ts: number) {
    return timeAgo(ts, this.nowTs());
  }

  until(ts: number) {
    return relativeTime(ts, this.nowTs());
  }

  nextDose(ts: number | null) {
    return nextDoseLabel(ts, this.nowTs());
  }

  /**
   * The bare countdown the night board and the sick-card hero read: "can give now" / "in 1h 40m",
   * without the "next dose" prefix the strip's fuller sentence carries.
   *
   * `null` is *no guidance*, not *cannot give* (api.md → GET /api/dashboard), so it says so in
   * words rather than rendering an em dash the caregiver has to interpret.
   */
  countdown(nextAllowedAt: number | null) {
    if (nextAllowedAt == null) return 'no interval given';
    return this.doseReady(nextAllowedAt) ? 'can give now' : timeUntil(nextAllowedAt, this.nowTs());
  }

  doseReady(ts: number | null) {
    return ts != null && ts <= this.nowTs();
  }

  /**
   * The patient's identity color, same mechanism the hub header and the patient list already use:
   * an `accent-{token}` class sets the CSS custom properties that `.accent-rail` and `.accent-dot`
   * read (styles.css → patient accent colors).
   *
   * Guarded rather than assumed. The token now arrives on every dashboard row that names a
   * patient, but a payload from an older API would leave it undefined, and the failure mode to
   * avoid is a *wrong* color rather than a missing one — no class means the utilities fall back to
   * neutral, which reads as "no color", not as some other child.
   */
  accentClass(token: PatientAccentColor | undefined | null) {
    return token ? `accent-${token}` : '';
  }
}

/** Sort helper: a `null` timestamp has no claim on the caregiver's attention, so it sorts last. */
function nullsLast(ts: number | null): number {
  return ts == null ? Number.POSITIVE_INFINITY : ts;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// The scale labels are read, not computed against — one decimal is the precision a thermometer
// reports and the precision the rest of the card already shows.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
