import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { nextDoseLabel, timeAgo, relativeTime } from '../core/relative-time';
import { errorText } from '../core/error-display';
import { DashboardPayload } from '@salud/shared/types';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent],
  template: `
    <div class="card">
      <h1>Dashboard</h1>
      <div class="actions">
        <button class="primary" type="button" (click)="goToNewObservation()">Create observation</button>
        <button class="secondary" type="button" (click)="goToNewIntervention()">Log intervention</button>
        <button class="secondary" type="button" (click)="goToMedications()">Medication catalog</button>
        <button class="secondary" type="button" (click)="goToAnalytes()">Analyte catalog</button>
        <button class="secondary" type="button" (click)="goToNewSchedule()">New schedule</button>
      </div>

      <div class="advisories" *ngIf="dashboard()?.unacknowledgedAdvisories?.length">
        <h2>Needs attention</h2>
        <app-advisory-banner
          *ngFor="let a of dashboard()!.unacknowledgedAdvisories"
          [advisory]="a"
        ></app-advisory-banner>
      </div>

      <section class="last-doses" *ngIf="dashboard()?.lastDoses?.length">
        <h2>Last doses</h2>
        <ul class="dose-list">
          <li *ngFor="let p of dashboard()!.lastDoses">
            <div class="row-main"><strong>{{ p.patientName }}</strong></div>

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
          <li *ngFor="let w of whatsNewSummaries()">
            <button type="button" class="row-link" (click)="goToWhatsNew(w.patientId)">
              <div class="row-main">
                <strong>{{ w.patientName }}</strong>
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

      <section *ngIf="dashboard()?.activeEpisodes?.length">
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
              <div class="med-row" *ngFor="let m of ep.medications">
                <span class="pill pill-danger" *ngIf="m.isAtypicalLastDose">atypical</span>
                {{ m.medicationName }} — last dose {{ ago(m.lastDoseAt) }}
                <span *ngIf="nextDose(m.nextAllowedAt) as label">· {{ label }}</span>
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
          !dashboard()!.lastDoses.length &&
          !whatsNewSummaries().length &&
          !dashboard()!.activeEpisodes.length &&
          !dashboard()!.upcomingSchedules.length &&
          !dashboard()!.shoppingList.length &&
          !dashboard()!.unacknowledgedAdvisories.length
        "
      >
        Nothing needs attention right now.
      </p>

      <!-- An unreachable API must say so. A blank dashboard reads as "nothing has been logged",
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
        border-top: 1px solid rgba(255, 255, 255, 0.08);
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
        color: #cbd5e1;
      }
      .next {
        font-size: 0.85rem;
        color: #cbd5e1;
      }
      .next.ready {
        color: #86efac;
      }
      .schedule-list li {
        padding: 0.6rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .schedule-list li.overdue {
        border-color: rgba(248, 113, 113, 0.4);
        background: rgba(248, 113, 113, 0.08);
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
      .episode-card {
        width: 100%;
        text-align: left;
        padding: 0.6rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .episode-card:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .med-row {
        font-size: 0.85rem;
        color: #cbd5e1;
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .shopping-list li {
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
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

  // One request for the whole page. The WYWA counts used to cost an extra GET /patients plus one
  // GET /patients/:id/whats-new per patient; they now ride along on the dashboard payload.
  private load() {
    this.api.get<DashboardPayload>('/dashboard').subscribe({
      next: (res) => {
        this.dashboard.set(res);
        this.error.set(null);
      },
      error: (err) => {
        this.dashboard.set(null);
        this.error.set(errorText(err, 'Could not load the dashboard.'));
      },
    });
  }

  goToWhatsNew(patientId: string) {
    this.router.navigate(['/patients', patientId, 'whats-new']);
  }

  goToNewObservation() {
    this.router.navigate(['/observations/new']);
  }

  goToNewIntervention() {
    this.router.navigate(['/interventions/new']);
  }

  goToAnalytes() {
    this.router.navigate(['/analytes']);
  }

  goToMedications() {
    this.router.navigate(['/medications']);
  }

  goToNewSchedule() {
    this.router.navigate(['/schedules/new']);
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

  // Thin wrappers around core/relative-time.ts — re-evaluated on every change-detection pass, so
  // they self-refresh on any interaction. No live ticker: the dashboard is opened fresh in the
  // case that matters (frontend.md → "Times on this page are relative, not absolute").
  ago(ts: number) {
    return timeAgo(ts);
  }

  until(ts: number) {
    return relativeTime(ts);
  }

  nextDose(ts: number | null) {
    return nextDoseLabel(ts);
  }

  doseReady(ts: number | null) {
    return ts != null && ts <= Math.floor(Date.now() / 1000);
  }
}
