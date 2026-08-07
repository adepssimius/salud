import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { DashboardPayload, Patient, WhatsNewResponse } from '@salud/shared/types';

interface WhatsNewSummary {
  patientId: string;
  patientName: string;
  eventCount: number;
  advisoryCount: number;
  nowDueCount: number;
}

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
        <button class="secondary" type="button" (click)="goToNewSchedule()">New schedule</button>
      </div>

      <div class="advisories" *ngIf="dashboard()?.unacknowledgedAdvisories?.length">
        <h2>Needs attention</h2>
        <app-advisory-banner
          *ngFor="let a of dashboard()!.unacknowledgedAdvisories"
          [advisory]="a"
        ></app-advisory-banner>
      </div>

      <section *ngIf="whatsNewSummaries().length">
        <h2>While you were asleep</h2>
        <ul class="schedule-list">
          <li *ngFor="let w of whatsNewSummaries()">
            <button type="button" class="row-link" (click)="goToWhatsNew(w.patientId)">
              <div class="row-main">
                <strong>{{ w.patientName }}</strong>
              </div>
              <div class="muted small">
                {{ w.eventCount }} new event{{ w.eventCount === 1 ? '' : 's' }}
                <span *ngIf="w.advisoryCount"> · {{ w.advisoryCount }} advisor{{ w.advisoryCount === 1 ? 'y' : 'ies' }} fired</span>
                <span *ngIf="w.nowDueCount"> · {{ w.nowDueCount }} due now</span>
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
                <span class="pill" *ngIf="s.overdue">overdue</span>
              </div>
              <div class="muted small" *ngIf="s.nextDueAt">
                Due {{ s.nextDueAt * 1000 | date: 'medium' }}
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
            <button type="button" class="episode-card" (click)="goToTimeline(ep.patientId)">
              <div class="row-main">
                <strong>{{ ep.name }}</strong>
                <span class="muted">— {{ ep.patientName }}</span>
              </div>
              <div class="muted small" *ngIf="ep.lastObservationSummary">
                Last observed {{ ep.lastObservationSummary.observedAt * 1000 | date: 'short' }}
                ({{ ep.lastObservationSummary.entries[0]?.type }})
              </div>
              <div class="med-row" *ngFor="let m of ep.medications">
                <span class="pill" *ngIf="m.isAtypicalLastDose">atypical</span>
                Last dose {{ m.lastDoseAt * 1000 | date: 'short' }}
                <span *ngIf="m.nextAllowedAt">· next allowed {{ m.nextAllowedAt * 1000 | date: 'short' }}</span>
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
          !dashboard()!.activeEpisodes.length &&
          !dashboard()!.upcomingSchedules.length &&
          !dashboard()!.shoppingList.length &&
          !dashboard()!.unacknowledgedAdvisories.length
        "
      >
        Nothing needs attention right now.
      </p>
    </div>
  `,
  styles: [
    `
      .card {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
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
      }
      .small {
        font-size: 0.85rem;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .primary {
        padding: 0.7rem 1.1rem;
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
        font-weight: 700;
        cursor: pointer;
      }
      .secondary {
        padding: 0.7rem 1.1rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
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
      .shopping-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
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
      .pill {
        display: inline-flex;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(248, 113, 113, 0.15);
        border: 1px solid rgba(248, 113, 113, 0.4);
        color: #fca5a5;
        font-size: 0.75rem;
        font-weight: 700;
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
  whatsNewSummaries = signal<WhatsNewSummary[]>([]);

  ngOnInit(): void {
    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => {
          this.load();
          this.loadWhatsNew();
        },
        error: () => this.auth.logout(),
      });
    } else {
      this.load();
      this.loadWhatsNew();
    }
  }

  private load() {
    this.api.get<DashboardPayload>('/dashboard').subscribe({
      next: (res) => this.dashboard.set(res),
      error: () => this.dashboard.set(null),
    });
  }

  private loadWhatsNew() {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (patients) => {
        if (!patients.length) {
          this.whatsNewSummaries.set([]);
          return;
        }
        forkJoin(
          patients.map((p) =>
            this.api.get<WhatsNewResponse>(`/patients/${p.id}/whats-new`).pipe(
              catchError(() => of(null)),
            ),
          ),
        ).subscribe((results) => {
          const summaries: WhatsNewSummary[] = [];
          results.forEach((res, i) => {
            if (!res) return;
            const eventCount = res.events.length;
            const advisoryCount = res.advisoriesFired.length;
            const nowDueCount = res.nowDue.length;
            if (eventCount || advisoryCount || nowDueCount) {
              summaries.push({
                patientId: patients[i].id,
                patientName: patients[i].fullName,
                eventCount,
                advisoryCount,
                nowDueCount,
              });
            }
          });
          this.whatsNewSummaries.set(summaries);
        });
      },
      error: () => this.whatsNewSummaries.set([]),
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

  goToMedications() {
    this.router.navigate(['/medications']);
  }

  goToNewSchedule() {
    this.router.navigate(['/schedules/new']);
  }

  goToSchedule(scheduleId: string) {
    this.router.navigate(['/schedules', scheduleId]);
  }

  goToTimeline(patientId: string) {
    this.router.navigate(['/patients', patientId, 'timeline']);
  }

  logDose(scheduleId: string) {
    this.router.navigate(['/interventions/new'], { queryParams: { scheduleId } });
  }

  restock(embodimentId: string) {
    this.api.post(`/embodiments/${embodimentId}/restock`, {}).subscribe({
      next: () => this.load(),
    });
  }
}
