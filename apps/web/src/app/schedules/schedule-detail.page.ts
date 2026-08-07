import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { InterventionSchedule } from '@salud/shared/types';

@Component({
  selector: 'app-schedule-detail-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="schedule() as s">
      <button type="button" class="link" (click)="backToDashboard()">&larr; Dashboard</button>
      <h1>{{ s.label }}</h1>
      <div class="row">
        <span class="pill">{{ s.type === 'medication_dose' ? 'Medication' : 'Dressing change' }}</span>
        <span class="pill" [class.pill-active]="s.status === 'active'">{{ s.status }}</span>
        <span class="pill pill-danger" *ngIf="s.adherence.overdue">overdue</span>
      </div>

      <div class="timing muted" *ngIf="s.frequencyHours">Every {{ s.frequencyHours }} hours</div>
      <div class="timing muted" *ngIf="s.explicitTimes?.length">At {{ s.explicitTimes!.join(', ') }}</div>
      <div class="timing muted" *ngIf="s.nextDueAt">Next due {{ s.nextDueAt * 1000 | date: 'medium' }}</div>
      <div class="timing muted" *ngIf="!s.nextDueAt && s.status !== 'active'">No upcoming due date ({{ s.status }})</div>

      <section class="adherence">
        <h2>Intended vs. actual</h2>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">{{ s.adherence.loggedCount }}</div>
            <div class="stat-label">logged</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ s.adherence.expectedCount }}</div>
            <div class="stat-label">expected by now</div>
          </div>
          <div class="stat" [class.warn]="s.adherence.missed > 0">
            <div class="stat-value">{{ s.adherence.missed }}</div>
            <div class="stat-label">missed</div>
          </div>
          <div class="stat" *ngIf="s.adherence.remainingOccurrences !== null">
            <div class="stat-value">{{ s.adherence.remainingOccurrences }}</div>
            <div class="stat-label">remaining</div>
          </div>
        </div>
      </section>

      <div class="actions">
        <button type="button" class="primary" (click)="logNow()" [disabled]="s.status !== 'active' || logging()">
          {{ logging() ? 'Logging…' : 'Log now' }}
        </button>
        <button type="button" class="secondary" (click)="pause()" *ngIf="s.status === 'active'">Pause</button>
        <button type="button" class="secondary" (click)="resume()" *ngIf="s.status === 'paused'">Resume</button>
        <button type="button" class="secondary" (click)="complete()" *ngIf="s.status !== 'completed'">
          Mark complete
        </button>
      </div>

      <p class="muted" *ngIf="s.notes">{{ s.notes }}</p>
      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
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
      .link {
        align-self: flex-start;
        background: none;
        border: none;
        color: #7dd3fc;
        cursor: pointer;
        padding: 0;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .pill {
        display: inline-flex;
        padding: 0.15rem 0.6rem;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.15);
        border: 1px solid rgba(148, 163, 184, 0.35);
        color: #cbd5e1;
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: capitalize;
      }
      .pill-active {
        background: rgba(34, 211, 238, 0.15);
        border-color: rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
      }
      .pill-danger {
        background: rgba(248, 113, 113, 0.15);
        border-color: rgba(248, 113, 113, 0.4);
        color: #fca5a5;
      }
      .adherence {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
        gap: 0.75rem;
      }
      .stat {
        text-align: center;
        padding: 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .stat.warn {
        border-color: rgba(251, 191, 36, 0.4);
        background: rgba(251, 191, 36, 0.08);
      }
      .stat-value {
        font-size: 1.4rem;
        font-weight: 700;
      }
      .stat-label {
        font-size: 0.8rem;
        color: #cbd5e1;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .primary,
      .secondary {
        padding: 0.6rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        border: none;
        cursor: pointer;
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
export class ScheduleDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  scheduleId = this.route.snapshot.paramMap.get('id')!;
  schedule = signal<InterventionSchedule | null>(null);
  logging = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private load() {
    this.api.get<InterventionSchedule>(`/schedules/${this.scheduleId}`).subscribe({
      next: (s) => this.schedule.set(s),
      error: (err) => this.error.set(errorText(err, 'Unable to load schedule.')),
    });
  }

  logNow() {
    this.logging.set(true);
    this.api.post<{ intervention: unknown; schedule: InterventionSchedule }, unknown>(`/schedules/${this.scheduleId}/log`, {}).subscribe({
      next: (res) => {
        this.logging.set(false);
        this.schedule.set(res.schedule);
      },
      error: (err) => {
        this.logging.set(false);
        this.error.set(errorText(err, 'Could not log dose.'));
      },
    });
  }

  pause() {
    this.updateStatus('paused');
  }

  resume() {
    this.updateStatus('active');
  }

  complete() {
    this.updateStatus('completed');
  }

  private updateStatus(status: 'active' | 'paused' | 'completed') {
    this.api.patch<InterventionSchedule, { status: string }>(`/schedules/${this.scheduleId}`, { status }).subscribe({
      next: (s) => this.schedule.set(s),
      error: (err) => this.error.set(errorText(err, 'Could not update schedule.')),
    });
  }

  backToDashboard() {
    this.router.navigate(['/dashboard']);
  }
}
