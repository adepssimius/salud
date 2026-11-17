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
import { debounceTime } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  CreateScheduleDto,
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
      <h1>New Schedule</h1>
      <p class="muted">
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
            <select formControlName="type">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
          <label class="field" *ngIf="!prefillConditionId">
            <span>Episode (optional)</span>
            <select formControlName="episodeId">
              <option value="">None</option>
              <option *ngFor="let ep of activeEpisodes()" [value]="ep.id">{{ ep.name }}</option>
            </select>
          </label>
          <p class="muted condition-note" *ngIf="prefillConditionId">
            Linked to this Condition's standing regimen.
          </p>
        </div>

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
                  <button type="button" class="link" (click)="clearMedication()">change</button>
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

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Create schedule' }}
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
      .how-often {
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
        padding: 0.6rem 0.75rem 0.75rem;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .how-often legend {
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

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<Array<{ id: string; name: string }>>([]);
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
    episodeId: [''],
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
    if (this.prefillConditionId) {
      this.form.patchValue({ conditionId: this.prefillConditionId });
    } else if (this.prefillEpisodeId) {
      this.form.patchValue({ episodeId: this.prefillEpisodeId });
    }

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
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  private loadPatients() {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (res) => {
        this.patients.set(res);
        const current = this.form.getRawValue().patientId;
        const pid = this.prefillPatientId || current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          if (!this.prefillConditionId) this.loadEpisodes(pid);
        }
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load patients.')),
    });
  }

  private loadEpisodes(patientId: string) {
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => this.activeEpisodes.set(eps),
      error: () => this.activeEpisodes.set([]),
    });
  }

  onPatientChange(event: Event) {
    const pid = (event.target as HTMLSelectElement).value;
    if (pid) {
      this.form.patchValue({ patientId: pid });
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
    if (this.labelEdited) return;
    const v = this.form.getRawValue();
    const embodiment = this.embodiments().find((e) => e.id === v.medicationEmbodimentId) ?? null;
    const name = scheduleName({
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
    if (name !== v.label) this.form.controls.label.setValue(name, { emitEvent: false });
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

    const body: CreateScheduleDto = {
      type: val.type,
      label: val.label,
      episodeId: val.conditionId ? undefined : val.episodeId || undefined,
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

  cancel() {
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
