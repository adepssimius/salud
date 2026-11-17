import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, entrySummary, fromCm, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { timeAgo, timeUntil } from '../core/relative-time';
import {
  Episode,
  EpisodeEventRef,
  InterventionSchedule,
  ScheduleSkip,
  TimelineEntry,
  TimelineResponse,
  UpdateEpisodeEventsRequest,
  UpdateScheduleDto,
} from '@salud/shared/types';
import { EpisodeEntryPickerComponent, PickedEntry, entryKey } from './episode-entry-picker.component';
import {
  DayCell,
  LogItem,
  ScheduleProgress,
  buildLog,
  dayStrip,
  localDaysBetween,
  scheduleProgress,
} from './episode-course';
import { DayTile, endShift, sinceStart, untilDone } from '../schedules/course-days';

/**
 * A measurement older than this is flagged in the summary — the caregiver is comparing against a
 * number that may no longer describe the patient (frontend.md → Episode detail → "Where are we").
 * A display nudge about the record's age, not a clinical threshold.
 */
export const STALE_MEASUREMENT_DAYS = 7;

/** Observation entry types that are a reading of the patient, as against a note or a tag. */
const MEASUREMENT_TYPES = new Set(['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score', 'lesion_size']);

interface Treatment {
  key: string;
  label: string;
  count: number;
}

interface Measurement {
  text: string;
  timestamp: number;
}

interface Comparison {
  id: string;
  timestamp: number;
  photos: string[];
  size: string | null;
}

interface ScheduleRow {
  schedule: InterventionSchedule;
  progress: ScheduleProgress;
}

// "What happened during this episode", in the order a caregiver asks it (frontend.md → Episode
// detail): where are we, are we keeping up, is it getting better, and what exactly happened.
// Two requests: GET /episodes/:id (with its schedules and the medicines its doses name) and the
// episode-filtered timeline for the hydrated events.
@Component({
  selector: 'app-episode-detail-page',
  standalone: true,
  imports: [CommonModule, AdvisoryBannerComponent, PhotoThumbnailComponent, EpisodeEntryPickerComponent],
  template: `
    <div class="card page">
      <button type="button" class="link back" (click)="backToPatient()">&larr; Patient</button>

      <ng-container *ngIf="episode() as ep">
        <div class="card-header">
          <div>
            <h1>{{ ep.name }}</h1>
            <p class="muted">
              <span class="pill" [class.pill-neutral]="ep.status === 'resolved'">{{ ep.status }}</span>
            </p>
          </div>
          <div class="header-actions">
            <button type="button" class="secondary" (click)="goToErBrief()">ER Brief</button>
            <button type="button" class="primary" *ngIf="ep.status === 'active'" (click)="resolveEpisode()">
              Resolve
            </button>
          </div>
        </div>
        <p class="muted small" *ngIf="ep.notes">{{ ep.notes }}</p>

        <!-- 1. Where are we -->
        <section class="summary" aria-label="Summary">
          <div class="fact" *ngIf="ep.startedAt">
            <span class="fact-label">{{ ep.status === 'active' ? 'Day' : 'Lasted' }}</span>
            <span class="fact-value">
              <ng-container *ngIf="ep.status === 'active'; else lasted">{{ dayNumber() }}</ng-container>
              <ng-template #lasted>{{ dayNumber() }} {{ dayNumber() === 1 ? 'day' : 'days' }}</ng-template>
            </span>
            <span class="muted small">
              started {{ fmtDate(ep.startedAt) }}<ng-container *ngIf="ep.endedAt"> · ended {{ fmtDate(ep.endedAt) }}</ng-container>
            </span>
          </div>
          <div class="fact" *ngIf="treatments().length">
            <span class="fact-label">Treatment</span>
            <span class="fact-value treatment" *ngFor="let t of treatments()">
              {{ t.label }} <span class="muted small">· {{ t.count }} {{ t.count === 1 ? 'dose' : 'doses' }}</span>
            </span>
          </div>
          <div class="fact" *ngIf="lastIntervention() as d">
            <span class="fact-label">{{ d.type === 'medication_dose' ? 'Last dose' : 'Last dressing change' }}</span>
            <span class="fact-value">{{ describe(d) }}</span>
            <span class="muted small">{{ fmtWhen(d.timestamp) }} · {{ ago(d.timestamp) }}</span>
          </div>
          <div class="fact" *ngIf="lastMeasurement() as m">
            <span class="fact-label">Last measurement</span>
            <span class="fact-value">{{ m.text }}</span>
            <span class="small">
              <span class="muted">{{ fmtWhen(m.timestamp) }} · {{ ago(m.timestamp) }}</span>
              <span class="pill pill-danger stale" *ngIf="measurementIsOld()">
                {{ daysSince(m.timestamp) }} days old
              </span>
            </span>
          </div>
        </section>
      </ng-container>

      <section *ngIf="advisories().length">
        <h2>Advisories</h2>
        <app-advisory-banner *ngFor="let a of advisories()" [advisory]="a"></app-advisory-banner>
      </section>

      <!-- 2. Are we keeping up -->
      <section *ngIf="episode() as ep" class="keeping-up">
        <div class="section-header">
          <h2>Keeping up</h2>
          <div class="section-actions">
            <button type="button" class="secondary" *ngIf="ep.status === 'active'" (click)="addSchedule()">
              Add a schedule
            </button>
            <!-- An existing schedule, on any episode: one course can treat two overlapping
                 episodes, and a past course can be filed afterwards (frontend.md → "Keeping up"). -->
            <button type="button" class="secondary" (click)="startAttaching()" [attr.aria-expanded]="attaching()">
              Attach a schedule
            </button>
          </div>
        </div>

        <div class="attach" *ngIf="attaching()">
          <p class="small muted" *ngIf="attachLoading()">Loading schedules…</p>
          <ng-container *ngIf="!attachLoading()">
            <p class="small" *ngIf="attachCandidates().length">Choose a schedule this episode is being treated with.</p>
            <p class="small muted" *ngIf="!attachCandidates().length">Every schedule for this patient is already attached here.</p>
            <ul class="row-list attach-list" *ngIf="attachCandidates().length">
              <li *ngFor="let c of attachCandidates()" class="attach-row">
                <span class="attach-text">
                  <span class="attach-label">{{ c.label }}</span>
                  <span class="pill pill-neutral" *ngIf="c.status !== 'active'">{{ c.status }}</span>
                  <span class="muted small" *ngIf="alsoOn(c) as others"> · also on {{ others }}</span>
                </span>
                <button type="button" class="secondary" (click)="attach(c)" [disabled]="scheduleBusy()">Attach</button>
              </li>
            </ul>
          </ng-container>
          <button type="button" class="link" (click)="attaching.set(false)">Close</button>
        </div>
        <p class="error" *ngIf="scheduleError()">{{ scheduleError() }}</p>

        <ul class="row-list schedules" *ngIf="scheduleRows().length">
          <li *ngFor="let r of scheduleRows()" class="schedule">
            <div class="schedule-head">
              <button type="button" class="link schedule-label" (click)="openSchedule(r.schedule)">{{ r.schedule.label }}</button>
              <span class="pill pill-neutral" *ngIf="r.progress.state === 'paused'">paused</span>
              <span class="pill pill-success" *ngIf="r.progress.state === 'complete'">course complete</span>
              <button type="button" class="secondary detach" (click)="detach(r.schedule)" [disabled]="scheduleBusy()">Detach</button>
            </div>
            <!-- A record, not a score (frontend.md → Episode detail → "Are we keeping up"): where we
                 are in the course, in days, with the end as it now stands. The end is the API's
                 courseEndsAt (shared with the schedule page, course-days.ts), so a course pushed by
                 late or skipped doses says so instead of grading the doses against the old plan. -->
            <div class="course-days">
              <div class="day-stat" *ngIf="courseSince(r.schedule) as d">
                <span class="day-value">{{ d.value }}</span>
                <span class="day-label">{{ d.label }}</span>
              </div>
              <div class="day-stat" *ngIf="courseUntil(r.schedule) as d">
                <span class="day-value">{{ d.value }}</span>
                <span class="day-label">{{ d.label }}</span>
              </div>
            </div>
            <p class="small ends" *ngIf="r.schedule.adherence?.courseEndsAt as end">
              Last dose {{ fmtWhen(end) }}<ng-container *ngIf="shift(r.schedule) as m"> · planned {{ fmtDate(m.plannedAt) }}, moved {{ m.days }} {{ m.days === 1 ? 'day' : 'days' }} later by late or skipped doses</ng-container>
            </p>
            <!-- Only linked doses count (api.md → "Linking existing doses"); matching doses logged
                 without the schedule are named, with the way to link them, not quietly added. -->
            <div class="unlinked" *ngIf="r.progress.unlinked">
              <span class="small">
                {{ r.progress.unlinked }} {{ r.progress.unlinked === 1 ? 'dose' : 'doses' }} of
                {{ r.schedule.type === 'medication_dose' ? 'this medicine' : 'this treatment' }} in this episode
                {{ r.progress.unlinked === 1 ? "isn't" : "aren't" }} linked to the schedule, so
                {{ r.progress.unlinked === 1 ? "it doesn't" : "they don't" }} count.
              </span>
              <button type="button" class="secondary" (click)="linkDoses(r.schedule)">Link them</button>
            </div>
            <div class="progress">
              <span class="small">
                <ng-container *ngIf="r.progress.doses; else givenOnly">{{ r.progress.doses.given }} of {{ r.progress.doses.total }} doses given</ng-container>
                <ng-template #givenOnly>{{ r.progress.given }} {{ r.progress.given === 1 ? 'dose' : 'doses' }} given</ng-template>
                <span class="muted" *ngIf="r.progress.skipped"> · {{ r.progress.skipped }} skipped</span>
              </span>
              <span class="bar" role="presentation" *ngIf="r.progress.doses || r.progress.days"><span class="bar-fill" [style.width.%]="progressPct(r)"></span></span>
            </div>
            <p class="small next" *ngIf="r.progress.nextDueAt as next">
              <ng-container *ngIf="next <= nowSec(); else upcoming">
                <span class="pill pill-danger">overdue</span> was due {{ fmtWhen(next) }}
              </ng-container>
              <ng-template #upcoming>Next due {{ fmtWhen(next) }} · {{ until(next) }}</ng-template>
            </p>
          </li>
        </ul>
        <p class="muted small" *ngIf="!scheduleRows().length">
          No schedule for this episode<ng-container *ngIf="ep.status === 'active'"> — add one, or attach one already running, to track a course of treatment</ng-container>.
        </p>

        <div class="strip-wrap" *ngIf="strip().length">
          <p class="small muted strip-caption">
            {{ scheduleRows().length ? 'Doses each day against the schedule' : 'Doses each day' }}
          </p>
          <ol class="strip">
            <li
              *ngFor="let c of strip()"
              class="cell"
              [class.short]="c.short"
              [class.met]="c.expected !== null && !c.short && c.count >= c.expected"
              [class.today]="c.isToday"
              [attr.title]="cellTitle(c)"
              [attr.aria-label]="cellTitle(c)"
            >
              <span class="cell-day">{{ c.dayNumber }}</span>
              <span class="cell-count">{{ c.count }}<span class="cell-of" *ngIf="c.expected !== null">/{{ c.expected }}</span></span>
            </li>
          </ol>
        </div>
      </section>

      <!-- 3. Is it getting better -->
      <section *ngIf="comparisons().length" class="better">
        <h2>Is it getting better?</h2>
        <p class="muted small" *ngIf="comparisons().length === 1">Only one so far — the next photo or size will sit beside it.</p>
        <ol class="compare">
          <li *ngFor="let c of comparisons()" class="compare-item">
            <span class="small compare-date">{{ fmtDate(c.timestamp) }}</span>
            <app-photo-thumbnail *ngFor="let fid of c.photos" [fileId]="fid" [large]="true"></app-photo-thumbnail>
            <span class="no-photo muted small" *ngIf="!c.photos.length">No photo</span>
            <span class="small" *ngIf="c.size">{{ c.size }}</span>
            <span class="muted small" *ngIf="!c.size">No size recorded</span>
          </li>
        </ol>
      </section>

      <!-- 4. What exactly happened -->
      <section>
        <div class="section-header">
          <h2>Log</h2>
          <div class="header-actions" *ngIf="episode()">
            <button type="button" class="secondary" *ngIf="editing() && !adding()" (click)="startAdding()">Add entries</button>
            <button type="button" class="secondary" (click)="toggleEditing()">{{ editing() ? 'Done' : 'Edit' }}</button>
          </div>
        </div>

        <!-- Membership is edited from here (frontend.md -> Episode detail). Each change is a
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

        <div class="log" *ngIf="events().length; else noEvents">
          <ng-container *ngFor="let item of log()">
            <div class="log-day" *ngIf="item.kind === 'day'">
              <h3 class="day-heading">{{ fmtDate(item.day.dayStart) }}</h3>
              <ul class="events">
                <ng-container *ngFor="let e of item.day.entries">
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: e }"></ng-container>
                </ng-container>
              </ul>
            </div>
            <div class="log-day run" *ngIf="item.kind === 'run'">
              <button type="button" class="run-toggle" (click)="toggleRun(item.key)" [attr.aria-expanded]="isOpen(item.key)">
                <span class="day-heading">{{ fmtDate(item.first) }} – {{ fmtDate(item.last) }}</span>
                <span>{{ item.count }} × {{ treatmentLabel(item.sample) }}</span>
                <span class="muted small">{{ isOpen(item.key) ? 'Hide' : 'Show each' }}</span>
              </button>
              <ng-container *ngIf="isOpen(item.key) || editing()">
                <div *ngFor="let d of item.days" class="run-day">
                  <h3 class="day-heading">{{ fmtDate(d.dayStart) }}</h3>
                  <ul class="events">
                    <ng-container *ngFor="let e of d.entries">
                      <ng-container *ngTemplateOutlet="row; context: { $implicit: e }"></ng-container>
                    </ng-container>
                  </ul>
                </div>
              </ng-container>
            </div>
          </ng-container>
        </div>
        <ng-template #noEvents>
          <p class="muted" *ngIf="loaded()">No events recorded for this episode yet.</p>
        </ng-template>

        <ng-template #row let-e>
          <li>
            <span class="ts">{{ fmtTime(e.timestamp) }}</span>
            <button type="button" class="feed-text-link" (click)="openEvent(e)">{{ describe(e) }}</button>
            <app-photo-thumbnail *ngFor="let fid of photos(e)" [fileId]="fid"></app-photo-thumbnail>
            <span class="row-end">
              <span class="pill pill-neutral role" *ngIf="isStart(e)">started this episode</span>
              <span class="pill pill-neutral role" *ngIf="isEnd(e)">ended it</span>
              <button
                type="button"
                class="link remove"
                *ngIf="editing() && events().length > 1"
                [disabled]="busy()"
                (click)="remove(e)"
              >
                Remove
              </button>
            </span>
          </li>
        </ng-template>
      </section>

      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .page {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-width: 0;
      }
      .card-header {
        flex-wrap: wrap;
      }
      .muted {
        margin: 0;
      }
      .back {
        align-self: flex-start;
      }
      .pill {
        text-transform: capitalize;
      }
      section {
        border-top: 1px solid var(--border);
        padding-top: 0.85rem;
        min-width: 0;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 0.85rem 1.25rem;
      }
      .fact {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
      }
      .fact-label {
        color: var(--text-dim);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .fact-value {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .pill.stale {
        text-transform: none;
        margin-left: 0.35rem;
      }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 0.5rem;
      }
      .section-header h2 {
        margin: 0;
      }
      .schedules {
        gap: 0.75rem;
        margin-bottom: 0.85rem;
      }
      .schedule {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.75rem;
        background: var(--surface-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
      }
      .schedule p {
        margin: 0;
      }
      .schedule-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .schedule-label {
        font-weight: 600;
        text-align: left;
      }
      .section-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      /* Pushed to the row's end, away from the label a thumb is reaching for; behind a confirm. */
      .detach {
        margin-left: auto;
        padding: 0.3rem 0.7rem;
        font-size: 0.85rem;
      }
      .attach {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
        margin-bottom: 0.85rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
      }
      .attach p {
        margin: 0;
      }
      .attach-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .attach-text {
        min-width: 0;
      }
      .attach-label {
        font-weight: 600;
        margin-right: 0.35rem;
      }
      .unlinked {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 0.75rem;
        padding: 0.5rem 0.65rem;
        border-radius: var(--radius-input);
        background: var(--accent-bg);
        border: 1px solid var(--accent-border);
      }
      .course-days {
        display: flex;
        gap: 0.5rem;
        margin: 0.25rem 0;
      }
      .day-stat {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 0.4rem 0.6rem;
        border-radius: var(--radius-input);
        background: var(--surface-raised);
        border: 1px solid var(--border);
      }
      .day-value {
        font-size: 1.35rem;
        font-weight: 700;
      }
      .day-label {
        font-size: 0.8rem;
        color: var(--text-muted);
      }
      .ends {
        margin: 0.25rem 0 0.5rem;
        color: var(--text-muted);
      }
      .progress {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .bar {
        display: block;
        height: 6px;
        border-radius: var(--radius-pill);
        background: var(--surface-raised);
        overflow: hidden;
      }
      .bar-fill {
        display: block;
        height: 100%;
        background: var(--accent-gradient);
      }
      .next .pill {
        text-transform: none;
        margin-right: 0.25rem;
      }
      .strip-wrap {
        margin-top: 0.6rem;
      }
      .strip-caption {
        margin-bottom: 0.35rem;
      }
      .strip {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }
      .cell {
        width: 2.6rem;
        padding: 0.25rem 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        border-radius: var(--radius-input);
        background: var(--surface-raised);
        border: 1px solid var(--border);
      }
      .cell.met {
        background: var(--success-bg);
        border-color: var(--success-border);
      }
      /* A day that fell short is a record, not an alarm: caution, never danger. What can still be
         acted on is the "overdue" line above. The "1/2" text carries it, not the colour alone. */
      .cell.short {
        background: var(--caution-bg);
        border-color: var(--caution-border);
      }
      .cell.short .cell-count {
        color: var(--caution-text);
      }
      .cell.today {
        outline: 2px solid var(--accent-focus);
        outline-offset: 1px;
      }
      .cell-day {
        font-size: 0.65rem;
        color: var(--text-dim);
      }
      .cell-count {
        font-weight: 700;
      }
      .cell-of {
        font-weight: 400;
        font-size: 0.75rem;
        color: var(--text-muted);
      }
      .compare {
        list-style: none;
        margin: 0;
        padding: 0 0 0.35rem;
        display: flex;
        gap: 0.75rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
      }
      .compare-item {
        flex: 0 0 auto;
        width: 150px;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        scroll-snap-align: start;
      }
      .compare-date {
        color: var(--text-dim);
      }
      .no-photo {
        width: 136px;
        height: 136px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px dashed var(--border-strong);
        border-radius: 8px;
      }
      .log {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .day-heading {
        margin: 0 0 0.3rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--text-muted);
      }
      .events li {
        align-items: center;
        font-size: 0.9rem;
        flex-wrap: wrap;
      }
      .events .ts {
        min-width: 4.5rem;
      }
      .run-toggle {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.25rem 0.75rem;
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.65rem;
        background: var(--surface-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
        color: var(--text);
        cursor: pointer;
      }
      .run-toggle .day-heading {
        margin: 0;
      }
      .run-day {
        margin: 0.5rem 0 0 0.65rem;
      }
      .adding {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .actions {
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
  /** The events have arrived — until then "no events" would be a guess. */
  loaded = signal(false);
  advisories = signal<any[]>([]);
  error = signal<string | null>(null);
  editing = signal(false);
  adding = signal(false);
  toAdd = signal<PickedEntry[]>([]);
  busy = signal(false);
  /** "Attach a schedule": the patient's schedules not yet on this episode, and the other episodes' names. */
  attaching = signal(false);
  attachLoading = signal(false);
  attachCandidates = signal<InterventionSchedule[]>([]);
  private episodeNames = signal<Map<string, string>>(new Map());
  scheduleBusy = signal(false);
  scheduleError = signal<string | null>(null);
  openRuns = signal<Set<string>>(new Set());
  /** Skipped slot times per schedule — fetched only for schedules that have skipped any. */
  skips = signal<Map<string, number[]>>(new Map());
  /** Read once per load — the page is a snapshot, like the timeline it renders. */
  nowSec = signal(Math.floor(Date.now() / 1000));
  memberKeys = computed(() => new Set(this.events().map((e) => entryKey(e))));

  private medicationNames = computed(() => new Map((this.episode()?.medications ?? []).map((m) => [m.id, m.name])));
  private embodimentLabels = computed(
    () => new Map((this.episode()?.medications ?? []).flatMap((m) => m.embodiments.map((e) => [e.id, e.label] as const))),
  );

  dayNumber = computed(() => {
    const ep = this.episode();
    if (!ep?.startedAt) return 0;
    return localDaysBetween(ep.startedAt, ep.endedAt ?? this.nowSec()) + 1;
  });

  /** The episode's interventions grouped by medicine and embodiment — "what are we treating with". */
  treatments = computed<Treatment[]>(() => {
    const groups = new Map<string, Treatment>();
    for (const e of this.events()) {
      if (e.kind !== 'intervention') continue;
      const key = e.type === 'medication_dose' ? this.treatmentKey(e) : 'dressing';
      const g = groups.get(key) ?? { key, label: this.treatmentLabel(e), count: 0 };
      g.count++;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  });

  lastIntervention = computed(() => this.newest(this.events().filter((e) => e.kind === 'intervention')));

  lastMeasurement = computed<Measurement | null>(() => {
    const units = unitsFor(this.auth.user());
    const sorted = [...this.events()].filter((e) => e.kind === 'observation').sort((a, b) => b.timestamp - a.timestamp);
    for (const e of sorted) {
      const entries: any[] = (e.display as any).entries ?? [];
      const m = entries.find((x) => MEASUREMENT_TYPES.has(x.type));
      if (m) return { text: entrySummary(m, units), timestamp: e.timestamp };
      const sized = entries.find((x) => x.type === 'photo' && typeof x.metadata?.sizeCm === 'number');
      if (sized) return { text: `${fromCm(sized.metadata.sizeCm, units.length)} ${units.length} (photo)`, timestamp: e.timestamp };
    }
    return null;
  });

  measurementIsOld = computed(() => {
    const m = this.lastMeasurement();
    return !!m && this.daysSince(m.timestamp) >= STALE_MEASUREMENT_DAYS;
  });

  scheduleRows = computed<ScheduleRow[]>(() =>
    (this.episode()?.schedules ?? []).map((schedule) => ({
      schedule,
      progress: scheduleProgress(schedule, this.events(), this.nowSec()),
    })),
  );

  strip = computed<DayCell[]>(() => {
    const ep = this.episode();
    if (!ep?.startedAt) return [];
    return dayStrip(ep.startedAt, ep.endedAt ?? null, ep.schedules ?? [], this.events(), this.nowSec(), this.skips());
  });

  /** Observations carrying a photo or a size, oldest → newest: a progression is read forwards. */
  comparisons = computed<Comparison[]>(() => {
    const units = unitsFor(this.auth.user());
    return this.events()
      .filter((e) => e.kind === 'observation')
      .map((e) => {
        const entries: any[] = (e.display as any).entries ?? [];
        const lesion = entries.find((x) => x.type === 'lesion_size');
        const sized = entries.find((x) => x.type === 'photo' && typeof x.metadata?.sizeCm === 'number');
        const size = lesion
          ? entrySummary(lesion, units)
          : sized
            ? `${fromCm(sized.metadata.sizeCm, units.length)} ${units.length}`
            : null;
        return { id: e.id, timestamp: e.timestamp, photos: photoFileIds(e), size };
      })
      .filter((c) => c.photos.length || c.size)
      .sort((a, b) => a.timestamp - b.timestamp);
  });

  log = computed<LogItem[]>(() => buildLog(this.events(), (e) => this.isStart(e) || this.isEnd(e)));

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
        this.loadSkips(ep);
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load this episode.')),
    });
  }

  /**
   * A skipped slot is not a missed one, so the day strip needs to know which slots were skipped. Only schedules that have skipped any are asked — most have none.
   */
  private loadSkips(ep: Episode) {
    const withSkips = (ep.schedules ?? []).filter((s) => (s.adherence?.skippedCount ?? 0) > 0);
    if (!withSkips.length) {
      this.skips.set(new Map());
      return;
    }
    forkJoin(withSkips.map((s) => this.api.get<ScheduleSkip[]>(`/schedules/${s.id}/skips`))).subscribe({
      next: (lists) => this.skips.set(new Map(withSkips.map((s, i) => [s.id, lists[i].map((k) => k.slotAt)]))),
      // Without them a skipped slot reads as missed — the pre-skip picture, not a broken page.
      error: () => this.skips.set(new Map()),
    });
  }

  // The episode's own event list comes from the timeline filtered to this episode — GET
  // /episodes/:id returns ids only, and this route already hydrates the entries.
  private loadEvents(patientId: string) {
    this.api
      .get<TimelineResponse>(`/patients/${patientId}/timeline`, { episodeId: this.episodeId })
      .subscribe({
        next: (res) => {
          this.nowSec.set(Math.floor(Date.now() / 1000));
          this.events.set(res.entries.filter((e) => e.kind !== 'advisory'));
          this.loaded.set(true);
          this.advisories.set(res.entries.filter((e) => e.kind === 'advisory').map((e) => e.display));
        },
        error: (err) => this.error.set(errorText(err, 'Unable to load this episode’s events.')),
      });
  }

  private newest(entries: TimelineEntry[]): TimelineEntry | null {
    return entries.reduce<TimelineEntry | null>((a, e) => (!a || e.timestamp > a.timestamp ? e : a), null);
  }

  private treatmentKey(e: TimelineEntry): string {
    const m = (e.display as any).metadata ?? {};
    return `${m.medicationId ?? ''}|${m.medicationEmbodimentId ?? ''}`;
  }

  /** "clotrimazole (1% cream)" — the medicine, and the embodiment when the dose named one. */
  treatmentLabel(e: TimelineEntry): string {
    if (e.type !== 'medication_dose') return 'dressing change';
    const m = (e.display as any).metadata ?? {};
    const name = this.medicationNames().get(m.medicationId) ?? 'medication dose';
    const emb = m.medicationEmbodimentId ? this.embodimentLabels().get(m.medicationEmbodimentId) : undefined;
    return emb ? `${name} (${emb})` : name;
  }

  ago(ts: number) {
    return timeAgo(ts, this.nowSec());
  }

  until(ts: number) {
    return timeUntil(ts, this.nowSec());
  }

  daysSince(ts: number): number {
    return localDaysBetween(ts, this.nowSec());
  }

  /** "Sat, Nov 7" — a real date, which the log and the comparison need and "4 days ago" is not. */
  fmtDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  fmtTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /** "today 8:10 PM", "yesterday 8:10 PM", "tomorrow 8:00 AM", else "Sat, Nov 7, 8:10 PM". */
  fmtWhen(ts: number): string {
    const diff = localDaysBetween(this.nowSec(), ts);
    const time = this.fmtTime(ts);
    if (diff === 0) return `today ${time}`;
    if (diff === -1) return `yesterday ${time}`;
    if (diff === 1) return `tomorrow ${time}`;
    return `${this.fmtDate(ts)}, ${time}`;
  }

  /**
   * Doses given of the course's total; for a date course, days elapsed of the days to its last
   * dose as it now stands (`courseEndsAt`), so a pushed end doesn't fill the bar early.
   */
  progressPct(r: ScheduleRow): number {
    const p = r.progress;
    let frac = 0;
    if (p.doses) frac = p.doses.given / p.doses.total;
    else if (p.state === 'complete') frac = 1;
    else if (p.days) {
      const end = r.schedule.adherence?.courseEndsAt ?? r.schedule.endAt!;
      const total = localDaysBetween(r.schedule.startAt, end) + 1;
      frac = total > 0 ? (localDaysBetween(r.schedule.startAt, this.nowSec()) + 1) / total : 0;
    }
    return Math.max(0, Math.min(100, Math.round(frac * 100)));
  }

  courseSince(s: InterventionSchedule): DayTile {
    return sinceStart(s, this.nowSec());
  }

  courseUntil(s: InterventionSchedule): DayTile | null {
    return untilDone(s, this.nowSec());
  }

  shift(s: InterventionSchedule) {
    return endShift(s);
  }

  cellTitle(c: DayCell): string {
    const doses = `${c.count} ${c.count === 1 ? 'dose' : 'doses'}`;
    const of = c.expected !== null ? ` of ${c.expected} expected` : '';
    const skipped = c.skipped ? `, ${c.skipped} skipped` : '';
    const notGiven = c.expected !== null ? c.expected - c.count - c.skipped : 0;
    const flag = c.short ? ` — ${notGiven} not given` : c.isToday ? ' — today' : '';
    return `Day ${c.dayNumber}, ${this.fmtDate(c.dayStart)}: ${doses}${of}${skipped}${flag}`;
  }

  describe(entry: TimelineEntry): string {
    return describeEvent(entry, unitsFor(this.auth.user()), { medicationNames: this.medicationNames() });
  }

  photos(entry: TimelineEntry): string[] {
    return photoFileIds(entry);
  }

  isOpen(key: string): boolean {
    return this.openRuns().has(key);
  }

  toggleRun(key: string) {
    const next = new Set(this.openRuns());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.openRuns.set(next);
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

  /** The schedule's own link checklist, opened straight away (frontend.md → Schedule detail). */
  linkDoses(s: InterventionSchedule) {
    this.router.navigate(['/schedules', s.id], { queryParams: { link: '1' } });
  }

  openSchedule(s: InterventionSchedule) {
    this.router.navigate(['/schedules', s.id]);
  }

  startAttaching() {
    const ep = this.episode();
    if (!ep) return;
    this.attaching.set(true);
    this.attachLoading.set(true);
    this.scheduleError.set(null);
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${ep.patientId}/episodes`).subscribe({
      next: (eps) => this.episodeNames.set(new Map(eps.map((e) => [e.id, e.name]))),
      error: () => this.episodeNames.set(new Map()),
    });
    this.api.get<InterventionSchedule[]>(`/patients/${ep.patientId}/schedules`).subscribe({
      next: (list) => {
        // Active first, then by name: the course being given now is the likely one.
        const rank = (s: InterventionSchedule) => (s.status === 'active' ? 0 : s.status === 'paused' ? 1 : 2);
        this.attachCandidates.set(
          list.filter((s) => !s.episodeIds.includes(ep.id)).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)),
        );
        this.attachLoading.set(false);
      },
      error: (err) => {
        this.attachLoading.set(false);
        this.attaching.set(false);
        this.scheduleError.set(errorText(err, 'Could not load this patient’s schedules.'));
      },
    });
  }

  /** The other episodes a candidate is on — "also on Fever" — so attaching a shared course is a choice made knowingly. */
  alsoOn(s: InterventionSchedule): string {
    const names = this.episodeNames();
    return s.episodeIds.map((id) => names.get(id)).filter(Boolean).join(', ');
  }

  /** PATCH the schedule's list with this episode added (api.md → "Editing a schedule"). No dose moves. */
  attach(s: InterventionSchedule) {
    this.updateScheduleEpisodes(s, [...s.episodeIds, this.episodeId], () => this.attaching.set(false));
  }

  /** The list with this episode removed. The schedule keeps running and every dose stays where it is. */
  detach(s: InterventionSchedule) {
    const ok = window.confirm(
      `Detach "${s.label}" from this episode? The schedule keeps running and its logged doses stay where they are; it just won't show here.`,
    );
    if (!ok) return;
    this.updateScheduleEpisodes(s, s.episodeIds.filter((id) => id !== this.episodeId));
  }

  private updateScheduleEpisodes(s: InterventionSchedule, episodeIds: string[], done?: () => void) {
    this.scheduleBusy.set(true);
    this.scheduleError.set(null);
    this.api.patch<InterventionSchedule, UpdateScheduleDto>(`/schedules/${s.id}`, { episodeIds }).subscribe({
      next: () => {
        this.scheduleBusy.set(false);
        done?.();
        // The episode read carries its schedules with adherence; re-read rather than patch locally.
        this.api.get<Episode>(`/episodes/${this.episodeId}`).subscribe({
          next: (ep) => {
            this.episode.set(ep);
            this.loadSkips(ep);
          },
          error: (err) => this.scheduleError.set(errorText(err, 'Unable to reload this episode.')),
        });
      },
      error: (err) => {
        this.scheduleBusy.set(false);
        this.scheduleError.set(errorText(err, 'Could not change this schedule’s episodes.'));
      },
    });
  }

  /** The existing new-schedule form, with this episode and its patient filled in. */
  addSchedule() {
    const ep = this.episode();
    if (!ep) return;
    this.router.navigate(['/schedules/new'], { queryParams: { patientId: ep.patientId, episodeId: ep.id } });
  }

  isStart(e: TimelineEntry): boolean {
    const ep = this.episode();
    return !!ep && ep.startedAtType === e.kind && ep.startedAtId === e.id;
  }

  isEnd(e: TimelineEntry): boolean {
    const ep = this.episode();
    return !!ep && ep.endedAtType === e.kind && ep.endedAtId === e.id;
  }

  toggleEditing() {
    const next = !this.editing();
    this.editing.set(next);
    if (!next) this.adding.set(false);
  }

  startAdding() {
    this.editing.set(true);
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
   * its contents. Remove only shows behind Edit, so a scrolling thumb can't hit it.
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
        // The membership route returns the plain Episode; keep the schedules and medicine names
        // this page loaded with rather than blanking them until the next full read.
        const prev = this.episode();
        this.episode.set({ ...ep, schedules: ep.schedules ?? prev?.schedules, medications: ep.medications ?? prev?.medications });
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
