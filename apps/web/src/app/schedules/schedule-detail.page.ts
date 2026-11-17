import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { InterventionSchedule, formatPillCount, ScheduleDose, ScheduleDosesResponse, UpdateScheduleDosesRequest } from '@salud/shared/types';

@Component({
  selector: 'app-schedule-detail-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="schedule() as s">
      <button type="button" class="link" (click)="backToDashboard()">&larr; Dashboard</button>
      <h1>{{ s.label }}</h1>
      <div class="row">
        <span class="pill pill-neutral">{{ s.type === 'medication_dose' ? 'Medication' : 'Dressing change' }}</span>
        <span class="pill pill-neutral" [class.pill-active]="s.status === 'active'">{{ s.status }}</span>
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

        <!-- Right under the numbers it corrects: unlinked doses of this medicine read as missed
             (frontend.md → Schedule detail → "Linking existing doses"). -->
        <div class="link-offer" *ngIf="candidates().length && !linking()">
          <p>
            {{ candidates().length }} {{ candidates().length === 1 ? 'dose' : 'doses' }} of this
            {{ s.type === 'medication_dose' ? 'medicine' : 'treatment' }} {{ candidates().length === 1 ? 'was' : 'were' }}
            logged without this schedule since it started, so {{ candidates().length === 1 ? 'it counts' : 'they count' }} as missed.
          </p>
          <button type="button" class="primary" (click)="startLinking()">Link existing doses</button>
        </div>

        <div class="linking" *ngIf="linking()">
          <p class="muted small">
            Choose the doses that were given for this schedule. Each keeps how it was logged; the
            link is recorded in its history.
          </p>
          <ul class="row-list">
            <li *ngFor="let d of candidates()">
              <label class="inline-check">
                <input type="checkbox" [checked]="picked().has(d.interventionId)" (change)="togglePick(d.interventionId)" />
                <span>{{ when(d.performedAt) }}</span>
                <span class="muted small" *ngIf="amount(d) as a">· {{ a }}</span>
              </label>
            </li>
          </ul>
          <div class="link-actions">
            <button type="button" class="secondary" (click)="linking.set(false)">Cancel</button>
            <button type="button" class="primary" [disabled]="!picked().size || saving()" (click)="linkPicked()">
              Link {{ picked().size }} {{ picked().size === 1 ? 'dose' : 'doses' }}
            </button>
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

      <!-- Doses on this schedule, and the ad hoc ones that could be (frontend.md → Schedule detail
           → "Linking existing doses"). Adherence counts linked doses only, so an unlinked dose of
           this medicine reads as missed until it is linked here. -->
      <section class="doses">
        <h2>Doses</h2>

        <ul class="row-list linked" *ngIf="linked().length; else noDoses">
          <li *ngFor="let d of linked()">
            <span>{{ when(d.performedAt) }}</span>
            <span class="muted small" *ngIf="amount(d) as a">{{ a }}</span>
            <span class="pill pill-neutral">{{ d.linkedLater ? 'linked later' : 'from schedule' }}</span>
            <button type="button" class="link unlink" *ngIf="d.linkedLater" [disabled]="saving()" (click)="unlink(d)">
              Unlink
            </button>
          </li>
        </ul>
        <ng-template #noDoses><p class="muted small">No doses on this schedule yet.</p></ng-template>
      </section>

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
      }
      .link {
        align-self: flex-start;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .pill {
        text-transform: capitalize;
      }
      /* Puts an accent-coloured pill back over the neutral base for the active state. */
      .pill-active {
        background: var(--accent-bg);
        border-color: var(--accent-border);
        color: var(--accent-soft);
      }
      .adherence {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .adherence h2 {
        margin: 0;
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
      .doses {
        border-top: 1px solid var(--border);
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .doses h2 {
        margin: 0;
      }
      .link-offer {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.75rem;
        border-radius: var(--radius-control);
        background: var(--accent-bg);
        border: 1px solid var(--accent-border);
      }
      .link-offer p {
        margin: 0;
      }
      .linking {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .linking p {
        margin: 0;
      }
      .link-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .linked li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .linked .pill {
        text-transform: none;
      }
      .unlink {
        margin-left: auto;
      }
      .actions {
        justify-content: flex-start;
        gap: 0.5rem;
        flex-wrap: wrap;
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
  linked = signal<ScheduleDose[]>([]);
  candidates = signal<ScheduleDose[]>([]);
  linking = signal(false);
  picked = signal<Set<string>>(new Set());
  saving = signal(false);
  /** Opened from the new-schedule form with doses to offer: start with the link list open. */
  private offerLinking = this.route.snapshot.queryParamMap?.get('link') === '1';

  ngOnInit(): void {
    this.load();
  }

  // One request: the schedule with its adherence, its doses, and the doses it could take.
  private load() {
    this.api.get<ScheduleDosesResponse>(`/schedules/${this.scheduleId}/doses`).subscribe({
      next: (res) => {
        this.apply(res);
        if (this.offerLinking && res.candidates.length) this.startLinking();
        this.offerLinking = false;
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load schedule.')),
    });
  }

  private apply(res: ScheduleDosesResponse) {
    this.schedule.set(res.schedule);
    this.linked.set(res.linked);
    this.candidates.set(res.candidates);
  }

  /** Every candidate preselected — the usual case is "all of those were for this" — untick any that weren't. */
  startLinking() {
    this.picked.set(new Set(this.candidates().map((d) => d.interventionId)));
    this.linking.set(true);
  }

  togglePick(id: string) {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  linkPicked() {
    this.saveDoses({ link: [...this.picked()] }, () => this.linking.set(false));
  }

  unlink(d: ScheduleDose) {
    this.saveDoses({ unlink: [d.interventionId] });
  }

  private saveDoses(body: UpdateScheduleDosesRequest, done?: () => void) {
    this.saving.set(true);
    this.error.set(null);
    this.api.post<ScheduleDosesResponse, UpdateScheduleDosesRequest>(`/schedules/${this.scheduleId}/doses`, body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.apply(res);
        done?.();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not change the doses on this schedule.'));
      },
    });
  }

  when(ts: number): string {
    return new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  amount(d: ScheduleDose): string | null {
    if (d.amountMg != null) return `${d.amountMg} mg`;
    if (d.amountMl != null) return `${d.amountMl} mL`;
    if (d.pillCount != null) return `×${formatPillCount(d.pillCount)}`;
    return null;
  }

  logNow() {
    this.logging.set(true);
    this.api.post<{ intervention: unknown; schedule: InterventionSchedule }, unknown>(`/schedules/${this.scheduleId}/log`, {}).subscribe({
      next: (res) => {
        this.logging.set(false);
        this.schedule.set(res.schedule);
        this.load();
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
