import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { TimelineEntry, WhatsNewResponse } from '@salud/shared/types';

// The 6 AM shift-change briefing (F-6.1). Loading this page never acks it — only the explicit
// "Mark as seen" button does, so a glance doesn't destroy the briefing before it's been read.
@Component({
  selector: 'app-whats-new-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent, PhotoThumbnailComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <div>
          <h1>While you were asleep</h1>
          <p class="muted" *ngIf="response() as r">Since {{ r.since * 1000 | date: 'medium' }}</p>
        </div>
        <div class="header-actions">
          <button class="secondary" type="button" (click)="backToDashboard()">← Dashboard</button>
          <button class="primary" type="button" (click)="ack()" [disabled]="acking() || acked()">
            {{ acked() ? 'Marked as seen' : acking() ? 'Marking…' : 'Mark as seen' }}
          </button>
        </div>
      </div>

      <ng-container *ngIf="response() as r">
        <section *ngIf="r.nowDue.length">
          <h2>Due now</h2>
          <ul class="row-list">
            <li *ngFor="let s of r.nowDue">
              <button type="button" class="row-link" (click)="goToSchedule(s.scheduleId)">
                <strong>{{ s.label }}</strong>
                <span class="pill" *ngIf="s.overdue">overdue</span>
                <span class="muted small" *ngIf="s.nextDueAt"> — due {{ s.nextDueAt * 1000 | date: 'short' }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section *ngIf="r.advisoriesFired.length">
          <h2>Advisories fired</h2>
          <app-advisory-banner *ngFor="let a of r.advisoriesFired" [advisory]="a"></app-advisory-banner>
        </section>

        <section *ngIf="r.events.length">
          <h2>Events</h2>
          <ul class="events">
            <li *ngFor="let e of r.events">
              <span class="ts">{{ e.timestamp * 1000 | date: 'short' }}</span>
              <span class="kind">{{ e.kind }}</span>
              <span>{{ describeEvent(e) }}</span>
              <app-photo-thumbnail *ngFor="let fid of photoFileIds(e)" [fileId]="fid"></app-photo-thumbnail>
            </li>
          </ul>
        </section>

        <p class="muted" *ngIf="!r.nowDue.length && !r.advisoriesFired.length && !r.events.length">
          Nothing new since last time.
        </p>
      </ng-container>

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
      .row-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .row-link {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .pill {
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(248, 113, 113, 0.2);
        color: #fca5a5;
        font-size: 0.75rem;
        font-weight: 700;
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
        font-size: 0.9rem;
      }
      .ts {
        color: #94a3b8;
        min-width: 100px;
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
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
export class WhatsNewPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = '';
  response = signal<WhatsNewResponse | null>(null);
  error = signal<string | null>(null);
  acking = signal(false);
  acked = signal(false);

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load() {
    this.api.get<WhatsNewResponse>(`/patients/${this.patientId}/whats-new`).subscribe({
      next: (res) => this.response.set(res),
      error: (err) => this.error.set(errorText(err, 'Unable to load the briefing.')),
    });
  }

  describeEvent(entry: TimelineEntry): string {
    return describeEvent(entry, unitsFor(this.auth.user()));
  }

  // Photo entries render as thumbnails (F-8.2) rather than in the text line above.
  photoFileIds(entry: TimelineEntry): string[] {
    return photoFileIds(entry);
  }

  ack() {
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

  goToSchedule(scheduleId: string) {
    this.router.navigate(['/schedules', scheduleId]);
  }

  backToDashboard() {
    this.router.navigate(['/dashboard']);
  }
}
