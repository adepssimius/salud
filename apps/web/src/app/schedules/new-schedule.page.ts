import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { AmountBoxes, DoseAmountSync, amountBoxesFor, boxShown } from '../interventions/dose-amount-sync';
import { DoseGuidanceComponent } from '../interventions/dose-guidance.component';
import { InfoTipComponent } from '../core/info-tip.component';
import { PillCountInputComponent } from '../interventions/pill-count-input.component';
import { defaultDailyTimes, scheduleName } from './schedule-name';
import { MISSED_DOSE_ACTION_LABELS, MISSED_DOSE_COURSE_EFFECT_LABELS } from './missed-dose-text';
import { debounceTime } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  MISSED_DOSE_ACTIONS,
  MISSED_DOSE_COURSE_EFFECTS,
  MissedDoseAction,
  MissedDoseCourseEffect,
  DoseCheckDto,
  DoseCheckResult,
  InterventionSchedule,
  Medication,
  MedicationEmbodiment,
  Patient,
  ScheduleDosesResponse,
  ScheduleType,
} from '@salud/shared/types';

@Component({
  selector: 'app-new-schedule-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DoseGuidanceComponent, PillCountInputComponent, InfoTipComponent],
  template: `
    <div class="card">
      <h1>{{ editId ? 'Edit schedule' : 'New Schedule' }}</h1>
      <p class="muted" *ngIf="!editId">
        Intent, not an event — "amoxicillin 400 mg every 8 h for 10 doses." Log the actual doses
        from the dashboard as they happen.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Patient</span>
          <select formControlName="patientId" (change)="onPatientChange($event)">
            <option value="">Select a patient</option>
            <option *ngFor="let p of patients()" [value]="p.id">{{ p.fullName }}</option>
          </select>
        </label>

        <div class="grid">
          <label class="field">
            <span>Type</span>
            <select formControlName="type" [attr.aria-describedby]="locked() ? 'locked-note' : null">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
          <p class="muted condition-note" *ngIf="prefillConditionId">
            Linked to this Condition's standing regimen.
          </p>
        </div>

        <!-- Any number of episodes, condition or not: one course can treat two episodes that
             happen to overlap (frontend.md → New schedule form → "Episodes"). -->
        <fieldset class="episodes">
          <legend>Episodes (optional)</legend>
          <label class="inline-check" *ngFor="let ep of episodeOptions()">
            <input type="checkbox" [checked]="episodeChecked(ep.id)" (change)="toggleEpisode(ep.id, $event)" />
            <span>{{ ep.name }}<span class="muted small" *ngIf="ep.status === 'resolved'"> · resolved</span></span>
          </label>
          <p class="muted small" *ngIf="!episodeOptions().length">No active episode for this patient.</p>
        </fieldset>

        <!-- A dose of one medicine must not count toward a schedule for another (api.md →
             "Editing a schedule"), so these two stay put once doses are logged. -->
        <p class="muted small" id="locked-note" *ngIf="locked()">
          Doses are already logged on this schedule, so its type and medicine stay as they are. To
          change them, mark it complete and start a new schedule.
        </p>

        <ng-container *ngIf="isMedication()">
          <div class="grid">
            <div class="field med-search">
              <span>Medication</span>
              <ng-container *ngIf="!selectedMedication(); else medicationChosen">
                <input
                  type="text"
                  placeholder="Search by generic or brand name…"
                  [value]="medicationQuery()"
                  (input)="onMedicationQueryChange($event)"
                />
                <ul class="med-results" *ngIf="medicationResults().length">
                  <li *ngFor="let m of medicationResults()">
                    <button type="button" class="med-result" (click)="selectMedication(m)">
                      <strong>{{ m.name }}</strong>
                      <span class="muted" *ngIf="m.brandNames.length"> — {{ m.brandNames.join(', ') }}</span>
                    </button>
                  </li>
                </ul>
              </ng-container>
              <ng-template #medicationChosen>
                <div class="chosen-med">
                  <span>{{ selectedMedication()!.name }}</span>
                  <button type="button" class="link" (click)="clearMedication()" *ngIf="!locked()">change</button>
                </div>
              </ng-template>
            </div>
            <label class="field">
              <span>Embodiment</span>
              <select formControlName="medicationEmbodimentId" [disabled]="!embodiments().length">
                <option value="">{{ selectedMedication() ? 'Select…' : 'Choose a medication first' }}</option>
                <option *ngFor="let e of embodiments()" [value]="e.id">{{ e.label }}</option>
              </select>
            </label>
          </div>
          <!-- The same guidance cards as the dose form, so a plan's amount is chosen against
               exactly what a dose's would be (frontend.md → New schedule form). Guidance only: the
               dose check's timing advisories judge one dose given now, not a plan, and every dose
               logged from the schedule is checked as usual. -->
          <app-dose-guidance
            *ngIf="selectedMedication()"
            [result]="doseCheck()"
            [hasEmbodiments]="embodiments().length > 0"
            (useWeightBased)="useWeightBasedAmount()"
            (useAgeBand)="useAgeBandAmount()"
          ></app-dose-guidance>

          <!-- The embodiment decides which amount boxes show, and they fill each other, exactly as
               on the dose form (frontend.md → "Dose entry"): a cream, ointment or gel has no
               amount to schedule, and a box holding a value always shows. -->
          <div class="grid" *ngIf="!noAmountBoxes(); else noAmount">
            <label class="field" *ngIf="showBox('mg')">
              <span>Dose (mg)</span>
              <input type="number" step="0.01" formControlName="doseMg" />
            </label>
            <label class="field" *ngIf="showBox('ml')">
              <span>Dose (mL)</span>
              <input type="number" step="0.01" formControlName="doseMl" />
            </label>
            <div class="field" role="group" aria-labelledby="schedule-count-label" *ngIf="showBox('pills')">
              <span id="schedule-count-label">{{ countLabel() }}</span>
              <app-pill-count-input formControlName="pillCount" [fractions]="countFractions()" [wholeLabel]="countLabel()" />
            </div>
          </div>
          <ng-template #noAmount>
            <p class="muted small">No amount to measure for this form — say how much in the notes if it matters.</p>
          </ng-template>
        </ng-container>

        <ng-container *ngIf="!isMedication()">
          <div class="grid">
            <label class="field">
              <span>Body location</span>
              <input type="text" formControlName="bodyLocation" />
            </label>
            <label class="field">
              <span>Side</span>
              <select formControlName="side">
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="bilateral">Bilateral</option>
                <option value="n/a">N/A</option>
              </select>
            </label>
            <label class="field">
              <span>Dressing type</span>
              <input type="text" formControlName="dressingType" />
            </label>
          </div>
        </ng-container>

        <!-- Two different instructions, chosen explicitly (frontend.md → New schedule form →
             "How often"): q6h is a strict interval around the clock; QID is four doses at times
             of day. Both were always storable (frequencyHours / explicitTimes); the form now
             says which one it is asking for. -->
        <fieldset class="how-often">
          <legend>How often</legend>
          <label class="inline-check">
            <input type="radio" formControlName="frequencyMode" value="interval" />
            <span>Every</span>
            <input class="short" type="number" step="0.5" min="0.25" formControlName="frequencyHours" aria-label="Hours between doses" />
            <span>hours <strong>(strict)</strong></span>
            <app-info-tip label="What does strict mean?">
              <strong>Strict:</strong> the next dose is due exactly that many hours after the last
              one, day and night. Use it when the label or prescriber says "every N hours".
              <ng-container *ngIf="intervalExample() as ex"><br />{{ ex }}</ng-container>
            </app-info-tip>
          </label>
          <label class="inline-check">
            <input type="radio" formControlName="frequencyMode" value="daily" />
            <input class="short" type="number" step="1" min="1" max="8" formControlName="timesPerDay" aria-label="Times a day" />
            <span>times a day</span>
            <app-info-tip label="What does times a day mean?">
              At the times you set, during the day — no overnight doses. Use it when the label or
              prescriber says "twice a day", "4 times a day" and so on.
            </app-info-tip>
          </label>
          <div class="daily-times" *ngIf="isDaily()" formArrayName="dailyTimes">
            <span class="muted small">at</span>
            <input *ngFor="let c of dailyTimes.controls; let i = index" type="time" [formControlName]="i" [attr.aria-label]="'Dose ' + (i + 1) + ' time'" />
          </div>
        </fieldset>

        <div class="grid">
          <label class="field">
            <span>Start</span>
            <input type="datetime-local" formControlName="startAt" />
          </label>
          <label class="field">
            <span>End after N doses (optional)</span>
            <input type="number" formControlName="endAfterOccurrences" />
          </label>
          <label class="field">
            <span>End date (optional)</span>
            <input type="datetime-local" formControlName="endAt" />
          </label>
        </div>

        <!-- What the prescriber or label said to do about a missed dose (frontend.md → New schedule
             form → "If a dose is missed"). Recorded, shown when a dose is missed, never decided by
             the app; left blank, the app gives no advice. -->
        <fieldset class="how-often">
          <legend>If a dose is missed</legend>
          <label class="field">
            <select formControlName="missedDoseAction" aria-label="Missed-dose instruction">
              <option value="">No instruction</option>
              <option *ngFor="let a of missedDoseActions" [value]="a">{{ actionLabels[a] }}</option>
            </select>
          </label>
          <label class="inline-check" *ngIf="isTakeLate()">
            <span>Skip it instead if the next dose is within</span>
            <input class="short" type="number" step="0.5" min="0.25" formControlName="missedDoseCutoffHours" aria-label="Cutoff in hours" />
            <span>hours</span>
            <app-info-tip label="What is the cutoff?">
              Optional. When the next dose is this close, the app says to skip the late one instead,
              as many labels do ("if it is almost time for the next dose, skip the missed dose").
            </app-info-tip>
          </label>
          <label class="field" *ngIf="hasEnd()">
            <span>Effect on the course</span>
            <select formControlName="missedDoseCourseEffect">
              <option value="">Not specified</option>
              <option *ngFor="let e of courseEffects" [value]="e">{{ effectLabels[e] }}</option>
            </select>
          </label>
          <label class="field" *ngIf="missedDoseActionValue()">
            <span>What the label or prescriber said (optional)</span>
            <input type="text" formControlName="missedDoseNote" placeholder="e.g. per the pharmacist, 11/16" />
          </label>
        </fieldset>

        <label class="field">
          <span>Notes</span>
          <textarea rows="2" formControlName="notes"></textarea>
        </label>

        <!-- Last, because it is written from everything above: what a nurse would call it, so it
             is recognisable where the ER Brief lists schedules. It follows the form until the
             caregiver types in it; emptying it hands it back. -->
        <label class="field">
          <span>Schedule name</span>
          <input type="text" formControlName="label" placeholder="500 mg Acetaminophen q6h"/>
          <span class="muted small" *ngIf="!labelEdited">Filled in from the choices above — type to name it yourself.</span>
        </label>

        <!-- An edit rewrites the whole course (api.md → "Editing a schedule"): said before saving,
             only when it changes something already counted. -->
        <p class="muted small rewrite-note" *ngIf="rewritesPast()">
          This recounts the whole course as if the new plan had always applied — {{ linkedCount() }}
          logged {{ linkedCount() === 1 ? 'dose stays' : 'doses stay' }} linked. If the prescription
          changed, mark this schedule complete and start a new one instead.
        </p>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || saving() || loadingEdit()">
            {{ saving() ? 'Saving…' : editId ? 'Save changes' : 'Create schedule' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .muted {
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
      }
      .med-search {
        position: relative;
      }
      .med-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 10;
        list-style: none;
        margin: 0.25rem 0 0;
        padding: 0.25rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #0b1224;
        max-height: 220px;
        overflow-y: auto;
      }
      .med-result {
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.6rem;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .med-result:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .chosen-med {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
      }
      .link {
        font-size: 0.85rem;
      }
      .how-often,
      .episodes {
        /* A fieldset's default min-inline-size is min-content, so a select with long option text
           pushed the whole page wider than a phone. */
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
        padding: 0.6rem 0.75rem 0.75rem;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .how-often select {
        width: 100%;
        max-width: 100%;
      }
      .how-often legend,
      .episodes legend {
        padding: 0 0.25rem;
        color: var(--text-muted);
      }
      .how-often .inline-check {
        flex-wrap: wrap;
      }
      .how-often input.short {
        width: 4.5rem;
      }
      .daily-times {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        margin-left: 1.6rem;
      }
      .daily-times input {
        width: 7.5rem;
      }
      .rewrite-note {
        margin: 0;
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
      }
    `,
  ],
})
export class NewSchedulePage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  prefillConditionId: string | null = null;
  prefillPatientId: string | null = null;
  /** Set when opened from an episode's "Add a schedule" — saved under it, and back out to it. */
  prefillEpisodeId: string | null = null;
  /** Set at /schedules/:id/edit: the same form, prefilled, saving with PATCH (frontend.md → Schedule detail → "Editing"). */
  editId: string | null = null;
  loadingEdit = signal(false);
  /** Doses linked to the schedule being edited; type and medicine are fixed once there are any. */
  linkedCount = signal(0);
  locked = computed(() => !!this.editId && this.linkedCount() > 0);
  /**
   * The episodes offered: every active one, plus any the schedule was attached to when the form
   * opened (an edit of a schedule on a resolved episode keeps it ticked rather than silently
   * dropping it, and unticking it by mistake can be undone).
   */
  episodeOptions = computed(() => {
    const attached = new Set([...this.episodeIdsAtLoad(), ...this.episodeIds()]);
    return this.patientEpisodes().filter((e) => e.status === 'active' || attached.has(e.id));
  });
  private episodeIdsAtLoad = signal<string[]>([]);
  /** The ticked episodes — the form's `episodeIds`. */
  episodeIds = signal<string[]>([]);
  /** The timing as loaded, to tell when an edit would recount a course that already has doses. */
  private timingBaseline: string | null = null;
  rewritesPast = signal(false);

  patients = signal<Patient[]>([]);
  patientEpisodes = signal<Array<{ id: string; name: string; status: string }>>([]);
  saving = signal(false);
  error = signal<string | null>(null);

  medicationQuery = signal('');
  medicationResults = signal<Medication[]>([]);
  selectedMedication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);

  form = this.fb.nonNullable.group({
    patientId: ['', Validators.required],
    label: ['', Validators.required],
    type: this.fb.control<ScheduleType>('medication_dose', { nonNullable: true }),
    conditionId: [''],
    medicationId: [''],
    medicationEmbodimentId: [''],
    doseMg: [null as number | null],
    doseMl: [null as number | null],
    pillCount: [null as number | null],
    bodyLocation: [''],
    side: ['n/a'],
    dressingType: [''],
    frequencyMode: this.fb.control<'interval' | 'daily'>('interval', { nonNullable: true }),
    frequencyHours: [null as number | null],
    timesPerDay: [null as number | null],
    dailyTimes: this.fb.nonNullable.array<string>([]),
    startAt: [this.defaultDateTime(), Validators.required],
    endAfterOccurrences: [null as number | null],
    endAt: [''],
    notes: [''],
    missedDoseAction: this.fb.control<MissedDoseAction | ''>('', { nonNullable: true }),
    missedDoseCutoffHours: [null as number | null],
    missedDoseCourseEffect: this.fb.control<MissedDoseCourseEffect | ''>('', { nonNullable: true }),
    missedDoseNote: [''],
  });

  // A signal over the form control: a plain computed() over `.value` never re-ran, so switching to
  // a dressing change left the medication fields on screen.
  private readonly typeValue = toSignal(this.form.controls.type.valueChanges, { initialValue: this.form.controls.type.value });
  isMedication = computed(() => this.typeValue() === 'medication_dose');

  private readonly modeValue = toSignal(this.form.controls.frequencyMode.valueChanges, { initialValue: this.form.controls.frequencyMode.value });
  isDaily = computed(() => this.modeValue() === 'daily');

  private readonly hoursValue = toSignal(this.form.controls.frequencyHours.valueChanges, { initialValue: this.form.controls.frequencyHours.value });

  /**
   * What a strict interval means on the clock, from the hours typed: "Every 6 hours: 08:00 →
   * 14:00 → 20:00 → 02:00 → 08:00 → … around the clock." Deliberately never "N doses a day" —
   * that is the "times a day" instruction, and saying it here is exactly the confusion the two
   * options exist to prevent.
   */
  intervalExample = computed(() => {
    const h = this.hoursValue();
    if (!h || h <= 0 || h >= 24) return null;
    const times = Array.from({ length: 5 }, (_, i) => {
      const m = Math.round(8 * 60 + i * h * 60) % (24 * 60);
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    });
    return `Every ${h} hours: ${times.join(' → ')} → … around the clock.`;
  });

  readonly missedDoseActions = MISSED_DOSE_ACTIONS;
  readonly courseEffects = MISSED_DOSE_COURSE_EFFECTS;
  readonly actionLabels = MISSED_DOSE_ACTION_LABELS;
  readonly effectLabels = MISSED_DOSE_COURSE_EFFECT_LABELS;
  private readonly actionSignal = toSignal(this.form.controls.missedDoseAction.valueChanges, { initialValue: this.form.controls.missedDoseAction.value });
  missedDoseActionValue = computed(() => this.actionSignal());
  isTakeLate = computed(() => this.actionSignal() === 'take_late_keep_times' || this.actionSignal() === 'take_late_restart');

  /** A course effect only means something for a course that ends. */
  hasEnd(): boolean {
    const v = this.form.getRawValue();
    return v.endAfterOccurrences != null || !!v.endAt;
  }

  get dailyTimes() {
    return this.form.controls.dailyTimes;
  }

  doseCheck = signal<DoseCheckResult | null>(null);
  /** True once the caregiver types a name of their own; the generated one then stays out of it. */
  labelEdited = false;

  /** mg, mL and the count fill each other from the selected embodiment — the dose form's own class. */
  private readonly amountSync = new DoseAmountSync(
    { mg: this.form.controls.doseMg, ml: this.form.controls.doseMl, pills: this.form.controls.pillCount },
    this.form.controls.medicationEmbodimentId,
    (id) => this.embodiments().find((e) => e.id === id),
  );

  ngOnInit(): void {
    this.prefillConditionId = this.route.snapshot.queryParamMap.get('conditionId');
    this.prefillPatientId = this.route.snapshot.queryParamMap.get('patientId');
    this.prefillEpisodeId = this.route.snapshot.queryParamMap.get('episodeId');
    this.editId = this.route.snapshot.paramMap?.get('id') ?? null;
    if (this.prefillConditionId) this.form.patchValue({ conditionId: this.prefillConditionId });
    if (this.prefillEpisodeId) this.episodeIds.set([this.prefillEpisodeId]);

    // A change to the name box itself is the caregiver's — the generated name is written with
    // emitEvent: false, so it never arrives here. It fires before the form-level change below,
    // so typing marks the name as theirs before the generator could overwrite it; emptying the
    // box hands the name back.
    // A count of times a day lays its times out across the waking day; each stays editable.
    // Typing in the count's box picks "times a day", as typing hours picks the interval.
    this.form.controls.timesPerDay.valueChanges.subscribe((n) => this.layOutDailyTimes(n));
    this.form.controls.frequencyHours.valueChanges.subscribe((h) => {
      if (h != null) this.form.controls.frequencyMode.setValue('interval');
    });
    this.form.controls.label.valueChanges.subscribe((v) => (this.labelEdited = !!v.trim()));
    this.form.valueChanges.subscribe(() => this.refreshName());
    this.form.valueChanges.pipe(debounceTime(400)).subscribe(() => this.runDoseCheck());
    this.form.valueChanges.subscribe(() =>
      this.rewritesPast.set(this.timingBaseline != null && this.linkedCount() > 0 && this.timingKey() !== this.timingBaseline),
    );
    if (this.editId) this.loadForEdit(this.editId);

    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadPatients(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadPatients();
    }
  }

  private defaultDateTime() {
    return this.localInput(Date.now());
  }

  /** A `datetime-local` value for an instant, in the browser's zone. */
  private localInput(ms: number) {
    const tzOffset = new Date(ms).getTimezoneOffset() * 60000;
    return new Date(ms - tzOffset).toISOString().slice(0, 16);
  }

  // ── Editing (frontend.md → Schedule detail → "Editing") ────────────────────────────────────

  /** Everything that decides which slots the course expects. */
  private timingKey(): string {
    const v = this.form.getRawValue();
    return JSON.stringify([
      v.startAt,
      v.frequencyMode,
      v.frequencyMode === 'interval' ? v.frequencyHours : [...v.dailyTimes].sort(),
      v.endAt,
      v.endAfterOccurrences,
    ]);
  }

  private loadForEdit(id: string) {
    this.loadingEdit.set(true);
    // The stored name is kept while the form fills; prefillFinished decides whether it is the
    // caregiver's own or the generated one, which keeps following the form.
    this.labelEdited = true;
    this.api.get<ScheduleDosesResponse>(`/schedules/${id}/doses`).subscribe({
      next: (res) => this.prefill(res),
      error: (err) => {
        this.loadingEdit.set(false);
        this.error.set(errorText(err, 'Unable to load schedule.'));
      },
    });
  }

  private prefill(res: ScheduleDosesResponse) {
    const s = res.schedule;
    this.linkedCount.set(res.linked.length);
    this.prefillPatientId = s.patientId;
    this.prefillConditionId = s.conditionId;
    this.form.patchValue({
      patientId: s.patientId,
      label: s.label,
      type: s.type,
      conditionId: s.conditionId ?? '',
      medicationId: s.medicationId ?? '',
      medicationEmbodimentId: s.medicationEmbodimentId ?? '',
      bodyLocation: s.bodyLocation ?? '',
      side: s.side ?? 'n/a',
      dressingType: s.dressingType ?? '',
      startAt: this.localInput(s.startAt * 1000),
      endAfterOccurrences: s.endAfterOccurrences,
      endAt: s.endAt ? this.localInput(s.endAt * 1000) : '',
      notes: s.notes ?? '',
      missedDoseAction: s.missedDoseAction ?? '',
      missedDoseCutoffHours: s.missedDoseCutoffHours,
      missedDoseCourseEffect: s.missedDoseCourseEffect ?? '',
      missedDoseNote: s.missedDoseNote ?? '',
    });
    if (s.explicitTimes?.length) {
      // The count lays out default times; the stored ones replace them.
      this.form.controls.timesPerDay.setValue(s.explicitTimes.length);
      const arr = this.form.controls.dailyTimes;
      arr.clear({ emitEvent: false });
      for (const t of [...s.explicitTimes].sort()) arr.push(this.fb.nonNullable.control(t), { emitEvent: false });
      arr.updateValueAndValidity();
    } else {
      this.form.patchValue({ frequencyHours: s.frequencyHours, frequencyMode: 'interval' });
    }
    // Stored amounts, not typing: the box later edits follow is the one the plan was most likely
    // written in.
    const source = s.doseMl != null ? 'ml' : s.pillCount != null ? 'pills' : s.doseMg != null ? 'mg' : null;
    this.amountSync.set({ mg: s.doseMg, ml: s.doseMl, pills: s.pillCount }, source);

    this.form.controls.patientId.disable({ emitEvent: false });
    if (this.locked()) this.form.controls.type.disable({ emitEvent: false });
    this.episodeIds.set([...s.episodeIds]);
    this.episodeIdsAtLoad.set([...s.episodeIds]);
    this.loadEpisodes(s.patientId);

    if (!s.medicationId) {
      this.prefillFinished(s);
      return;
    }
    this.api.get<Medication>(`/medications/${s.medicationId}`).subscribe({
      next: (m) => {
        this.selectedMedication.set(m);
        this.api.get<MedicationEmbodiment[]>(`/medications/${m.id}/embodiments`).subscribe({
          next: (list) => {
            this.embodiments.set(list);
            this.amountSync.refresh();
            this.prefillFinished(s);
          },
          error: () => this.prefillFinished(s),
        });
      },
      error: () => this.prefillFinished(s),
    });
  }

  /**
   * The stored name is the caregiver's own unless it is exactly what the form would generate from
   * the stored plan — then it keeps following the form, as it did when the schedule was created.
   */
  private prefillFinished(s: InterventionSchedule) {
    this.labelEdited = false;
    const generated = this.generatedName();
    this.labelEdited = generated !== s.label;
    this.timingBaseline = this.timingKey();
    this.loadingEdit.set(false);
  }

  private loadPatients() {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (res) => {
        this.patients.set(res);
        const current = this.form.getRawValue().patientId;
        const pid = this.prefillPatientId || current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          this.loadEpisodes(pid);
        }
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load patients.')),
    });
  }

  /** All the patient's episodes, so a resolved one the schedule is attached to can still be named. */
  private loadEpisodes(patientId: string) {
    this.api.get<Array<{ id: string; name: string; status: string }>>(`/patients/${patientId}/episodes`).subscribe({
      next: (eps) => this.patientEpisodes.set(eps),
      error: () => this.patientEpisodes.set([]),
    });
  }

  episodeChecked(id: string): boolean {
    return this.episodeIds().includes(id);
  }

  toggleEpisode(id: string, event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.episodeIds.update((ids) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)));
  }

  onPatientChange(event: Event) {
    const pid = (event.target as HTMLSelectElement).value;
    if (pid) {
      this.form.patchValue({ patientId: pid });
      // Another patient's episodes are not this one's to tick.
      this.episodeIds.set([]);
      this.loadEpisodes(pid);
    }
  }

  onMedicationQueryChange(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.medicationQuery.set(q);
    if (!q) {
      this.medicationResults.set([]);
      return;
    }
    this.api.get<Medication[]>('/medications', { q, activeOnly: true }).subscribe({
      next: (res) => this.medicationResults.set(res),
      error: () => this.medicationResults.set([]),
    });
  }

  selectMedication(medication: Medication) {
    this.selectedMedication.set(medication);
    this.refreshName();
    this.medicationResults.set([]);
    this.medicationQuery.set('');
    this.form.patchValue({ medicationId: medication.id, medicationEmbodimentId: '' });
    this.embodiments.set([]);
    this.api.get<MedicationEmbodiment[]>(`/medications/${medication.id}/embodiments`).subscribe({
      next: (res) => {
        this.embodiments.set(res);
        this.amountSync.refresh();
        this.refreshName();
      },
      error: () => this.embodiments.set([]),
    });
  }

  private layOutDailyTimes(n: number | null) {
    const count = n != null && n >= 1 && n <= 8 ? Math.floor(n) : 0;
    const arr = this.form.controls.dailyTimes;
    arr.clear({ emitEvent: false });
    for (const t of defaultDailyTimes(count)) arr.push(this.fb.nonNullable.control(t), { emitEvent: false });
    if (count) this.form.controls.frequencyMode.setValue('daily');
    arr.updateValueAndValidity();
  }

  ngOnDestroy(): void {
    this.amountSync.destroy();
  }

  /** The generated name, written in until the caregiver types their own. */
  private refreshName() {
    if (this.labelEdited || this.loadingEdit()) return;
    const name = this.generatedName();
    if (name !== this.form.getRawValue().label) this.form.controls.label.setValue(name, { emitEvent: false });
  }

  private generatedName(): string {
    const v = this.form.getRawValue();
    const embodiment = this.embodiments().find((e) => e.id === v.medicationEmbodimentId) ?? null;
    return scheduleName({
      type: v.type,
      medicationName: this.selectedMedication()?.name ?? null,
      embodiment,
      doseMg: v.doseMg,
      doseMl: v.doseMl,
      pillCount: v.pillCount,
      frequencyHours: v.frequencyMode === 'interval' ? v.frequencyHours : null,
      explicitTimes: v.frequencyMode === 'daily' ? v.dailyTimes : null,
      bodyLocation: v.bodyLocation,
      side: v.side,
    });
  }

  /** The dose check, for its guidance only (see the template). */
  private runDoseCheck() {
    const v = this.form.getRawValue();
    if (v.type !== 'medication_dose' || !v.medicationId || !v.patientId) {
      this.doseCheck.set(null);
      return;
    }
    const body: DoseCheckDto = {
      medicationId: v.medicationId,
      medicationEmbodimentId: v.medicationEmbodimentId || undefined,
      amountMg: this.amountSync.mgDerived() ? undefined : (v.doseMg ?? undefined),
      amountMl: v.doseMl ?? undefined,
      pillCount: v.pillCount ?? undefined,
      occurredAt: v.startAt ? new Date(v.startAt).toISOString() : undefined,
    };
    this.api.post<DoseCheckResult, DoseCheckDto>(`/patients/${v.patientId}/dose-checks`, body).subscribe({
      next: (res) => this.doseCheck.set(res),
      error: () => this.doseCheck.set(null),
    });
  }

  /** "Use this" fills the amounts as the dose form's does: mg as the source, the engine's mL kept. */
  useWeightBasedAmount() {
    const g = this.doseCheck()?.guidance.weightBased;
    if (!g) return;
    this.amountSync.set({ mg: Math.round(g.computedMg * 100) / 100, ml: g.computedMl }, 'mg');
    this.refreshName();
  }

  useAgeBandAmount() {
    const g = this.doseCheck()?.guidance.ageBand;
    if (!g) return;
    this.amountSync.set({ mg: g.doseMg, ml: g.doseMl, pills: g.pillCount }, 'mg');
    this.refreshName();
  }

  countLabel(): string {
    return this.amountBoxes().count ?? 'Pill count';
  }

  countFractions(): boolean {
    const boxes = this.amountBoxes();
    return boxes.count ? boxes.fractions : true;
  }

  amountBoxes(): AmountBoxes {
    const id = this.form.controls.medicationEmbodimentId.value;
    return amountBoxesFor(id ? this.embodiments().find((e) => e.id === id) : undefined);
  }

  showBox(box: 'mg' | 'ml' | 'pills'): boolean {
    const control = box === 'mg' ? this.form.controls.doseMg : box === 'ml' ? this.form.controls.doseMl : this.form.controls.pillCount;
    return boxShown(this.amountBoxes(), box) || control.value != null;
  }

  noAmountBoxes(): boolean {
    return !this.showBox('mg') && !this.showBox('ml') && !this.showBox('pills');
  }

  clearMedication() {
    this.selectedMedication.set(null);
    this.refreshName();
    this.embodiments.set([]);
    this.form.patchValue({ medicationId: '', medicationEmbodimentId: '' });
  }

  submit() {
    if (this.form.invalid || this.saving()) return;
    const val = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);

    const times = val.dailyTimes.map((t) => t.trim()).filter(Boolean);
    const explicitTimes = val.frequencyMode === 'daily' && times.length ? [...times].sort() : undefined;
    if (this.editId) {
      this.saveEdit(this.editId, explicitTimes);
      return;
    }

    const body: CreateScheduleDto = {
      type: val.type,
      label: val.label,
      episodeIds: this.episodeIds().length ? this.episodeIds() : undefined,
      conditionId: val.conditionId || undefined,
      startAt: new Date(val.startAt).toISOString(),
      frequencyHours: val.frequencyMode === 'interval' ? (val.frequencyHours ?? undefined) : undefined,
      explicitTimes,
      // Fixed times are wall-clock times where the household is; the server's clock is not that
      // (data-model.md → InterventionSchedule.timeZone). Sent for interval schedules too, so the
      // zone is already right if the timing later changes to fixed times.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      endAfterOccurrences: val.endAfterOccurrences ?? undefined,
      endAt: val.endAt ? new Date(val.endAt).toISOString() : undefined,
      notes: val.notes || undefined,
      ...(val.missedDoseAction
        ? {
            missedDoseAction: val.missedDoseAction,
            missedDoseCutoffHours: this.isTakeLate() ? (val.missedDoseCutoffHours ?? undefined) : undefined,
            missedDoseNote: val.missedDoseNote.trim() || undefined,
          }
        : {}),
      ...(val.missedDoseCourseEffect && this.hasEnd() ? { missedDoseCourseEffect: val.missedDoseCourseEffect } : {}),
    };

    if (val.type === 'medication_dose') {
      Object.assign(body, {
        medicationId: val.medicationId || undefined,
        medicationEmbodimentId: val.medicationEmbodimentId || undefined,
        doseMg: val.doseMg ?? undefined,
        doseMl: val.doseMl ?? undefined,
        pillCount: val.pillCount ?? undefined,
      });
    } else {
      Object.assign(body, {
        bodyLocation: val.bodyLocation || undefined,
        side: val.side as any,
        dressingType: val.dressingType || undefined,
      });
    }

    this.api.post<InterventionSchedule, CreateScheduleDto>(`/patients/${val.patientId}/schedules`, body).subscribe({
      next: (created) => this.offerLinkOrBackOut(created),
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not create schedule.'));
      },
    });
  }

  /**
   * Doses of this medicine already logged since the schedule's start count as missed until they
   * are linked (frontend.md → Schedule detail → "Linking existing doses"), so when there are any
   * the form hands over to the schedule page with the link list open rather than backing out.
   */
  private offerLinkOrBackOut(created: InterventionSchedule) {
    this.api.get<ScheduleDosesResponse>(`/schedules/${created.id}/doses`).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.candidates.length) this.router.navigate(['/schedules', created.id], { queryParams: { link: '1' } });
        else this.backOut();
      },
      error: () => {
        this.saving.set(false);
        this.backOut();
      },
    });
  }

  /**
   * PATCH with every field the form owns, null where it is empty, so a cleared box clears the
   * stored value (api.md → "Editing a schedule"). The zone is not sent: a schedule keeps its own
   * until someone changes it on the schedule page (data-model.md → InterventionSchedule.timeZone).
   */
  private saveEdit(id: string, explicitTimes: string[] | undefined) {
    const val = this.form.getRawValue();
    const medication = val.type === 'medication_dose';
    const action = val.missedDoseAction || null;
    const body: UpdateScheduleDto = {
      type: val.type,
      label: val.label,
      episodeIds: this.episodeIds(),
      conditionId: val.conditionId || null,
      startAt: new Date(val.startAt).toISOString(),
      frequencyHours: val.frequencyMode === 'interval' ? val.frequencyHours : null,
      explicitTimes: explicitTimes ?? null,
      endAfterOccurrences: val.endAfterOccurrences ?? null,
      endAt: val.endAt ? new Date(val.endAt).toISOString() : null,
      notes: val.notes.trim() || null,
      missedDoseAction: action,
      missedDoseCutoffHours: action && this.isTakeLate() ? (val.missedDoseCutoffHours ?? null) : null,
      missedDoseCourseEffect: val.missedDoseCourseEffect && this.hasEnd() ? val.missedDoseCourseEffect : null,
      missedDoseNote: action ? val.missedDoseNote.trim() || null : null,
      medicationId: medication ? val.medicationId || null : null,
      medicationEmbodimentId: medication ? val.medicationEmbodimentId || null : null,
      doseMg: medication ? val.doseMg : null,
      doseMl: medication ? val.doseMl : null,
      pillCount: medication ? val.pillCount : null,
      bodyLocation: medication ? null : val.bodyLocation || null,
      side: medication ? null : (val.side as UpdateScheduleDto['side']),
      dressingType: medication ? null : val.dressingType || null,
    };
    this.api.patch<InterventionSchedule, UpdateScheduleDto>(`/schedules/${id}`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/schedules', id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save the schedule.'));
      },
    });
  }

  cancel() {
    if (this.editId) {
      this.router.navigate(['/schedules', this.editId]);
      return;
    }
    this.backOut();
  }

  private backOut() {
    if (this.prefillEpisodeId) {
      this.router.navigate(['/episodes', this.prefillEpisodeId]);
    } else if (this.prefillConditionId) {
      this.router.navigate(['/conditions', this.prefillConditionId]);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
