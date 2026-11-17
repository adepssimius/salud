import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { InterventionSchedule, formatPillCount, ScheduleDose, ScheduleDosesResponse, UpdateScheduleDosesRequest, Condition, LogScheduleDto, MissedDoseState, ScheduleSkip, SkipScheduleDoseRequest, ScheduleDeleteResponse } from '@salud/shared/types';
import { MISSED_DOSE_COURSE_EFFECT_LABELS, adviceIsSkip, instructionSummary, missedDoseAdvice } from './missed-dose-text';

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
      <!-- The episodes this schedule treats — any number (frontend.md → Schedule detail). -->
      <div class="episode-links" *ngIf="episodeLinks().length">
        <span class="muted small">For</span>
        <button type="button" class="pill episode-link" *ngFor="let ep of episodeLinks()" (click)="goToEpisode(ep.id)">{{ ep.name }}</button>
      </div>

      <div class="timing muted" *ngIf="s.frequencyHours">Every {{ s.frequencyHours }} hours</div>
      <div class="timing muted" *ngIf="s.explicitTimes?.length">
        At {{ s.explicitTimes!.join(', ') }}<ng-container *ngIf="s.timeZone && s.timeZone !== browserZone">
          · {{ s.timeZone }} time</ng-container>
      </div>
      <div class="timing muted small" *ngIf="s.explicitTimes?.length && !s.timeZone">
        These times follow the server's clock, not yours.
        <button type="button" class="link" (click)="useMyTimeZone()" [disabled]="settingZone()">
          Use my time zone ({{ browserZone }})
        </button>
      </div>
      <div class="timing muted" *ngIf="s.nextDueAt">Next due {{ s.nextDueAt * 1000 | date: 'medium' }}</div>
      <div class="timing muted" *ngIf="!s.nextDueAt && s.status !== 'active'">No upcoming due date ({{ s.status }})</div>
      <div class="timing small instruction" *ngIf="summary(s) as text">
        <strong>If a dose is missed:</strong> {{ text }}<ng-container *ngIf="s.missedDoseNote"> — “{{ s.missedDoseNote }}”</ng-container>
        <ng-container *ngIf="s.missedDoseCourseEffect"><br />{{ effectLabels[s.missedDoseCourseEffect] }}</ng-container>
      </div>

      <!-- The current missed dose and what the instruction says about it (frontend.md → Schedule
           detail → "Missed doses"). The app repeats the instruction; the caregiver acts. -->
      <section class="missed" *ngIf="s.missedDose as m">
        <p class="missed-head">
          <span class="pill pill-danger">missed</span>
          Due {{ when(m.slotAt) }}
        </p>
        <p class="missed-advice" *ngIf="advice(m) as a">{{ a }}</p>
        <div class="missed-actions">
          <button type="button" [class.primary]="!skipFirst(m)" [class.secondary]="skipFirst(m)" (click)="logNow()" [disabled]="logging()" *ngIf="!m.doubleNextDue">
            {{ logging() ? 'Logging…' : 'Log it now' }}
          </button>
          <button type="button" class="primary" (click)="logDouble()" [disabled]="logging()" *ngIf="m.doubleNextDue">
            {{ logging() ? 'Logging…' : 'Log the double dose' }}
          </button>
          <button type="button" [class.primary]="skipFirst(m)" [class.secondary]="!skipFirst(m)" (click)="skip()" [disabled]="skipping()">
            Skip this dose
          </button>
        </div>
      </section>

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
          <!-- Skipped is not missed (data-model.md → ScheduleAdherence): shown so the numbers add up. -->
          <div class="stat" *ngIf="s.adherence.skippedCount">
            <div class="stat-value">{{ s.adherence.skippedCount }}</div>
            <div class="stat-label">skipped</div>
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
        <button type="button" class="secondary" (click)="edit()">Edit</button>
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

      <section class="doses" *ngIf="skips().length">
        <h2>Skipped doses</h2>
        <ul class="row-list linked">
          <li *ngFor="let k of skips()">
            <span>{{ when(k.slotAt) }}</span>
            <span class="pill pill-neutral">{{ k.reason === 'made_up_by_double' ? 'made up by a double dose' : 'skipped' }}</span>
            <button type="button" class="link unlink" *ngIf="k.reason === 'skipped'" (click)="unskip(k)" [disabled]="skipping()">Undo</button>
          </li>
        </ul>
      </section>

      <p class="muted" *ngIf="s.notes">{{ s.notes }}</p>
      <p class="error" *ngIf="error()">{{ error() }}</p>

      <!-- Last and apart: a schedule is a plan, deleting it never deletes a dose (frontend.md →
           Schedule detail → "Deleting"). -->
      <div class="delete-row">
        <button type="button" class="secondary delete" (click)="deleteSchedule()" [disabled]="deleting()">
          {{ deleting() ? 'Deleting…' : 'Delete schedule' }}
        </button>
      </div>
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
      .episode-links {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
      }
      /* An episode is named as the caregiver wrote it, not title-cased like the status pills. */
      .episode-link {
        text-transform: none;
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
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
      .instruction {
        color: var(--text-muted);
      }
      .missed {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
        border-radius: var(--radius-control);
        background: var(--danger-bg);
        border: 1px solid var(--danger-border);
      }
      .missed p {
        margin: 0;
      }
      .missed-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
      }
      .missed-advice {
        font-size: 1rem;
      }
      .missed-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
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
      .delete-row {
        border-top: 1px solid var(--border);
        padding-top: 0.75rem;
      }
      .delete {
        color: var(--danger-text);
        border-color: var(--danger-border);
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
  episodeLinks = signal<Array<{ id: string; name: string }>>([]);
  logging = signal(false);
  settingZone = signal(false);
  error = signal<string | null>(null);
  // The viewing browser's IANA zone: what a fixed-time schedule's times are captured in
  // (data-model.md → InterventionSchedule.timeZone).
  readonly browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
    this.loadEpisodeNames(res.schedule);
    this.loadSkips();
    this.loadContact(res.schedule);
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

  // ── Missed doses ──────────────────────────────────────────────────────────────────────────

  readonly effectLabels = MISSED_DOSE_COURSE_EFFECT_LABELS;
  skips = signal<ScheduleSkip[]>([]);
  skipping = signal(false);
  /** The prescriber line for "ask the prescriber": the schedule's condition's first contact. */
  contact = signal<string | null>(null);
  private contactFor: string | null = null;

  summary(s: InterventionSchedule): string | null {
    return instructionSummary(s.missedDoseAction, s.missedDoseCutoffHours);
  }

  advice(m: MissedDoseState): string | null {
    return missedDoseAdvice(m, (sec) => this.when(sec), this.contact());
  }

  skipFirst(m: MissedDoseState): boolean {
    return adviceIsSkip(m) || m.doubleNextDue;
  }

  private loadSkips() {
    this.api.get<ScheduleSkip[]>(`/schedules/${this.scheduleId}/skips`).subscribe({
      next: (rows) => this.skips.set(rows),
      error: () => this.skips.set([]),
    });
  }

  /** Names for the episode chips: one request for the patient's episodes, only when there are any. */
  private loadEpisodeNames(s: InterventionSchedule) {
    if (!s.episodeIds?.length) {
      this.episodeLinks.set([]);
      return;
    }
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${s.patientId}/episodes`).subscribe({
      next: (eps) => {
        const byId = new Map(eps.map((e) => [e.id, e.name]));
        this.episodeLinks.set(s.episodeIds.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)! })));
      },
      error: () => this.episodeLinks.set([]),
    });
  }

  goToEpisode(id: string) {
    this.router.navigate(['/episodes', id]);
  }

  private loadContact(s: InterventionSchedule) {
    if (s.missedDoseAction !== 'ask_prescriber' || !s.conditionId || this.contactFor === s.conditionId) return;
    this.contactFor = s.conditionId;
    this.api.get<Condition>(`/conditions/${s.conditionId}`).subscribe({
      next: (c) => {
        const first = c.contacts?.[0];
        this.contact.set(first ? `${first.name}${first.role ? ` (${first.role})` : ''}${first.phone ? ` ${first.phone}` : ''}` : null);
      },
      error: () => this.contact.set(null),
    });
  }

  skip() {
    this.skipping.set(true);
    this.error.set(null);
    this.api.post<InterventionSchedule, SkipScheduleDoseRequest>(`/schedules/${this.scheduleId}/skips`, {}).subscribe({
      next: () => {
        this.skipping.set(false);
        this.load();
      },
      error: (err) => {
        this.skipping.set(false);
        this.error.set(errorText(err, 'Could not skip this dose.'));
      },
    });
  }

  unskip(k: ScheduleSkip) {
    this.skipping.set(true);
    this.api.delete<InterventionSchedule>(`/schedules/${this.scheduleId}/skips/${k.id}`).subscribe({
      next: () => {
        this.skipping.set(false);
        this.load();
      },
      error: (err) => {
        this.skipping.set(false);
        this.error.set(errorText(err, 'Could not undo the skip.'));
      },
    });
  }

  /** "Take two next time": the schedule's amounts, doubled, with every dose check still run. */
  logDouble() {
    this.logging.set(true);
    this.error.set(null);
    this.api.post<{ intervention: unknown; schedule: InterventionSchedule }, LogScheduleDto>(`/schedules/${this.scheduleId}/log`, { double: true }).subscribe({
      next: () => {
        this.logging.set(false);
        this.load();
      },
      error: (err) => {
        this.logging.set(false);
        this.error.set(errorText(err, 'Could not log the double dose.'));
      },
    });
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

  useMyTimeZone() {
    this.settingZone.set(true);
    this.api
      .patch<InterventionSchedule, { timeZone: string }>(`/schedules/${this.scheduleId}`, { timeZone: this.browserZone })
      .subscribe({
        next: (s) => {
          this.settingZone.set(false);
          this.schedule.set(s);
        },
        error: (err) => {
          this.settingZone.set(false);
          this.error.set(errorText(err, 'Could not update schedule.'));
        },
      });
  }

  backToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  edit() {
    this.router.navigate(['/schedules', this.scheduleId, 'edit']);
  }

  // ── Deleting (frontend.md → Schedule detail → "Deleting") ────────────────────────────────

  deleting = signal(false);

  /** What the confirmation says will happen: the doses stay, unlinked; the skips go. */
  deleteMessage(s: InterventionSchedule): string {
    const doses = this.linked().length;
    const skips = this.skips().length;
    const lines = [`Delete "${s.label}"?`, ''];
    if (doses) {
      lines.push(
        `${doses} logged ${doses === 1 ? 'dose stays' : 'doses stay'} in the journal and the care record, no longer linked to a schedule.`,
      );
    } else {
      lines.push('No doses are logged on this schedule.');
    }
    if (skips) lines.push(`${skips} skipped ${skips === 1 ? 'dose is' : 'doses are'} removed with it.`);
    lines.push('', 'This cannot be undone. If the course really happened, Mark complete keeps it instead.');
    return lines.join('\n');
  }

  deleteSchedule() {
    const s = this.schedule();
    if (!s || this.deleting() || !window.confirm(this.deleteMessage(s))) return;
    this.deleting.set(true);
    this.error.set(null);
    this.api.delete<ScheduleDeleteResponse>(`/schedules/${this.scheduleId}`).subscribe({
      next: () => {
        this.deleting.set(false);
        // Back to where the schedule lived: its first episode or its condition, else Home.
        if (s.episodeIds?.length) this.router.navigate(['/episodes', s.episodeIds[0]]);
        else if (s.conditionId) this.router.navigate(['/conditions', s.conditionId]);
        else this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.deleting.set(false);
        this.error.set(errorText(err, 'Could not delete schedule.'));
      },
    });
  }
}
