import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime } from 'rxjs/operators';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { EpisodeAttachmentComponent, EpisodeOption } from '../quick-log/episode-attachment.component';
import { DangerInterstitialComponent } from '../core/danger-interstitial.component';
import { ERROR_SENTENCES, errorText } from '../core/error-display';
import {
  CorrectionEpisodeState,
  correctionResolves,
  episodeCorrection,
  toLocalDateTimeInput,
} from '../core/entry-correction';
import {
  CorrectableDoseSource,
  CreateInterventionDto,
  DOSE_SOURCES,
  DoseCheckDto,
  DoseCheckResult,
  DoseSource,
  InterventionSchedule,
  Intervention,
  InterventionType,
  Medication,
  MedicationEmbodiment,
  Patient,
  UpdateInterventionDto,
} from '@salud/shared/types';

/**
 * What `/interventions/:id/edit` hands this form to correct (frontend.md → "Correcting an entry").
 * Loaded by EditInterventionPage; the form itself never fetches the entry.
 */
export interface InterventionCorrectionContext {
  intervention: Intervention;
  patientName: string;
  /** Null when the recorder has left the care team — reads "Unknown caregiver". */
  recordedByName: string | null;
  /** The schedule this dose was logged against, by name; null when none (or it failed to load). */
  scheduleLabel: string | null;
  episodes: CorrectionEpisodeState;
}

/** The fixed facts of a correction, in words — never as disabled controls a caregiver can poke at. */
const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  medication_dose: 'Medication dose',
  dressing_change: 'Dressing change',
};

@Component({
  selector: 'app-new-intervention-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    AdvisoryBannerComponent,
    DangerInterstitialComponent,
    EpisodeAttachmentComponent,
  ],
  template: `
    <app-danger-interstitial
      *ngIf="showDangerInterstitial()"
      [advisories]="dangerAdvisories()"
      (proceed)="acknowledgeDangerAdvisories()"
      (backOut)="clearMedication()"
    ></app-danger-interstitial>

    <div class="card">
      <h1>{{ heading() }}</h1>
      <p class="muted" *ngIf="!compact() && !correction()">Record a medication dose or dressing change.</p>

      <!-- What a correction does not change, as plain text (frontend.md → "Correcting an entry" →
           Fixed): the type and schedule link say what the record is; attribution is not rewritten. -->
      <div class="fixed-facts" *ngIf="correction() as c">
        <p class="muted small">
          <span class="fixed-type">{{ typeLabel(c.intervention.type) }}</span>
          <ng-container *ngIf="isScheduledCorrection()">
            · logged against
            <span class="fixed-schedule">{{ c.scheduleLabel ?? 'a schedule' }}</span>
          </ng-container>
        </p>
        <p class="muted small">
          Recorded by {{ c.recordedByName ?? 'Unknown caregiver' }} · logged
          {{ c.intervention.createdAt * 1000 | date: 'medium' }}
        </p>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <!-- Pinned identity: with no patient select on screen, which chart this dose lands on is
             still never off-screen (frontend.md → "Patient identity"). -->
        <div class="for-patient" *ngIf="(compact() || correction()) && patientName()">
          <span class="muted small">For</span>
          <span class="for-patient-name">{{ patientName() }}</span>
        </div>
        <label class="field" *ngIf="!compact() && !correction()">
          <span>Patient</span>
          <select formControlName="patientId" (change)="onPatientChange($event)">
            <option value="" disabled>Select a patient</option>
            <option *ngFor="let p of patients()" [value]="p.id">
              {{ p.fullName }}
              <span *ngIf="p.myRole"> ({{ p.myRole }})</span>
            </option>
          </select>
        </label>

        <div class="grid">
          <label class="field">
            <span>Performed at</span>
            <input type="datetime-local" formControlName="performedAt" />
          </label>

          <label class="field" *ngIf="!compact() && !correction()">
            <span>Type</span>
            <select formControlName="type">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
        </div>

        <app-episode-attachment
          *ngIf="!correction(); else correctionEpisodes"
          [episodes]="activeEpisodes()"
          [selectedIds]="selectedEpisodeIds()"
          [createNew]="createNewEpisode()"
          [newEpisodeName]="form.getRawValue().startEpisodeName"
          [resolveSelected]="!!form.getRawValue().resolveSelected"
          (selectedIdsChange)="setEpisodeSelection($event)"
          (createNewChange)="setCreateNew($event)"
          (newEpisodeNameChange)="form.patchValue({ startEpisodeName: $event })"
          (resolveSelectedChange)="form.patchValue({ resolveSelected: $event })"
        ></app-episode-attachment>
        <ng-template #correctionEpisodes>
          <!-- The create picker, configured for a correction: no new episode, and the episode this
               entry started stays attached (frontend.md → "Correcting an entry" → Fixed). -->
          <app-episode-attachment
            [episodes]="correctionEpisodeOptions()"
            [selectedIds]="selectedEpisodeIds()"
            [allowCreateNew]="false"
            [lockedIds]="correctionLockedIds()"
            [resolveSelected]="correctionResolveSelected()"
            (selectedIdsChange)="setEpisodeSelection($event)"
            (resolveSelectedChange)="correctionResolveFlag.set($event)"
          ></app-episode-attachment>
        </ng-template>

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
                  <span>
                    {{ selectedMedication()!.name }}
                    <span class="muted" *ngIf="selectedMedication()!.brandNames.length">
                      ({{ selectedMedication()!.brandNames.join(', ') }})
                    </span>
                  </span>
                  <button type="button" class="link" (click)="clearMedication()">change</button>
                </div>
              </ng-template>
            </div>
            <label class="field">
              <span>Embodiment</span>
              <select formControlName="medicationEmbodimentId" [disabled]="!embodiments().length">
                <option value="">
                  {{ selectedMedication() ? 'Select…' : 'Choose a medication first' }}
                </option>
                <option *ngFor="let e of embodiments()" [value]="e.id">
                  {{ e.label }}{{ e.atHome ? ' · at home' : ' · not at home' }}{{ e.runningLow ? ' · running low' : '' }}{{ isExpired(e) ? ' · expired' : '' }}
                </option>
              </select>
            </label>
          </div>
          <div class="guidance-cards" *ngIf="selectedMedication()">
            <div class="guidance-card" *ngIf="doseCheckResult()?.guidance?.weightBased as wb">
              <div class="guidance-header">
                <span class="pill">Weight-based</span>
              </div>
              <div class="guidance-amount">
                {{ wb.computedMg | number: '1.0-1' }} mg<span *ngIf="wb.computedMl"> ({{ wb.computedMl }} mL)</span>
              </div>
              <div class="muted small">
                {{ wb.mgPerKg }} mg/kg × {{ wb.weightKgUsed }} kg
                <span *ngIf="wb.maxMgPerDose"> · max {{ wb.maxMgPerDose }} mg/dose</span>
              </div>
              <div class="muted small">Source: {{ wb.source }}</div>
              <button type="button" class="secondary small" (click)="useWeightBasedAmount()">Use this</button>
            </div>
            <div class="guidance-card" *ngIf="doseCheckResult()?.guidance?.ageBand as ab">
              <div class="guidance-header">
                <span class="pill">Age-band</span>
              </div>
              <div class="guidance-amount">
                {{ ab.doseMg }} mg<span *ngIf="ab.doseMl"> ({{ ab.doseMl }} mL)</span>
              </div>
              <div class="muted small">{{ ab.frequencyPerDay }}x/day · max {{ ab.maxMgPerDay }} mg/day</div>
              <div class="muted small">Source: {{ ab.source }}</div>
              <!-- A derived volume must never read as coming from the source line above it. -->
              <div class="muted small" *ngIf="ab.doseMlSource === 'derived'">
                mL from the selected bottle's concentration
              </div>
              <button type="button" class="secondary small" (click)="useAgeBandAmount()">Use this</button>
            </div>
            <p
              class="muted small"
              *ngIf="doseCheckResult() && !doseCheckResult()!.guidance.weightBased && !doseCheckResult()!.guidance.ageBand"
            >
              No applicable dosing guidance found for this medication{{
                embodiments().length ? '/embodiment' : ''
              }} yet.
            </p>
          </div>

          <div class="advisories" *ngIf="nonDangerAdvisories().length">
            <app-advisory-banner *ngFor="let a of nonDangerAdvisories()" [advisory]="a"></app-advisory-banner>
            <div class="quick-weight" *ngIf="hasStaleWeightAdvisory()">
              <input
                type="number"
                step="0.01"
                placeholder="Current weight (kg)"
                [ngModel]="quickWeightKg()"
                (ngModelChange)="quickWeightKg.set($event)"
                [ngModelOptions]="{ standalone: true }"
              />
              <button
                type="button"
                class="secondary small"
                (click)="saveQuickWeight()"
                [disabled]="!quickWeightKg() || savingWeight()"
              >
                {{ savingWeight() ? 'Saving…' : 'Log weight' }}
              </button>
            </div>
            <p class="error small" *ngIf="weightError()">{{ weightError() }}</p>
          </div>

          <div class="grid">
            <!-- A scheduled dose's source is what puts it in the plan's adherence count; it is fixed. -->
            <div class="field" *ngIf="isScheduledCorrection()">
              <span>Dose source</span>
              <span class="fixed-dose-source">From schedule</span>
            </div>
            <label class="field" *ngIf="!isScheduledCorrection()">
              <span>Dose source</span>
              <select formControlName="doseSource">
                <option value="weight_based">Weight based</option>
                <option value="age_based">Age based</option>
                <option value="override">Override</option>
              </select>
            </label>
            <label class="field">
              <span>Amount (mg)</span>
              <input type="number" step="0.01" formControlName="amountMg" />
            </label>
            <label class="field">
              <span>Amount (mL)</span>
              <input type="number" step="0.01" formControlName="amountMl" />
            </label>
            <label class="field">
              <span>Pill count</span>
              <input type="number" step="0.5" formControlName="pillCount" />
            </label>
          </div>
          <p class="muted small" *ngIf="correction()">
            Doses logged after this one keep the checks they were given at the time — correcting this
            one doesn't re-check them.
          </p>
          <div class="grid" *ngIf="!compact() && !correction()">
            <label class="field">
              <span>Schedule ID (optional)</span>
              <input type="text" formControlName="interventionScheduleId" />
            </label>
          </div>
        </ng-container>

        <ng-container *ngIf="isDressingChange()">
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

        <label class="field">
          <span>Notes</span>
          <textarea rows="3" formControlName="notes"></textarea>
        </label>

        <div class="actions">
          <button class="secondary" type="button" (click)="cancel()">Cancel</button>
          <button class="primary" type="submit" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : correction() ? 'Save correction' : 'Save' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
        <p class="muted" *ngIf="success()">Saved.</p>
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
      .guidance-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
      }
      .guidance-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
      }
      .guidance-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .guidance-amount {
        font-size: 1.3rem;
        font-weight: 700;
      }
      .advisories {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .quick-weight {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .quick-weight input {
        max-width: 180px;
      }
      .fixed-facts {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .fixed-type {
        color: var(--text);
        font-weight: 600;
      }
      .fixed-dose-source {
        padding: 0.65rem 0;
      }
      .secondary.small {
        padding: 0.4rem 0.7rem;
        font-size: 0.85rem;
        align-self: flex-start;
      }
    `,
  ],
})
export class NewInterventionPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Set by EditInterventionPage: this form corrects that intervention instead of logging a new one. */
  correction = input<InterventionCorrectionContext | null>(null);
  correctionEpisodeOptions = signal<EpisodeOption[]>([]);
  /** The picker's "this resolves…" switch on a correction; null until the caregiver touches it. */
  correctionResolveFlag = signal<boolean | null>(null);
  correctionLockedIds = computed(() => {
    const started = this.correction()?.episodes.startedId;
    return started ? [started] : [];
  });
  private correctionResolvesIds = computed(() => {
    const c = this.correction();
    return c ? correctionResolves(c.episodes, this.formEpisodeIds(), this.correctionResolveFlag()) : [];
  });
  correctionResolveSelected = computed(() => this.correctionResolvesIds().length > 0);

  private scheduleIdParam: string | null = null;
  private patientIdParam: string | null = null;
  /**
   * "Same as last time", handed over by Quick Log's recents step or Home's per-medication repeat
   * button. A prefill and nothing more.
   */
  private prefill: {
    medicationId?: string;
    embodimentId?: string;
    amountMg?: number;
    amountMl?: number;
    doseSource?: DoseSource;
  } | null = null;

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<EpisodeOption[]>([]);
  createNewEpisode = signal(false);
  /** Set by Quick Log: this form is doing one job, so the patient and type pickers step aside. */
  compact = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  medicationQuery = signal('');
  medicationResults = signal<Medication[]>([]);
  selectedMedication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);

  doseCheckResult = signal<DoseCheckResult | null>(null);
  quickWeightKg = signal<number | null>(null);
  savingWeight = signal(false);
  weightError = signal<string | null>(null);

  // A danger-class reaction candidate earns a full-screen interstitial (F-2.5) instead of an
  // inline banner. Re-armed on every fresh dose-check so a changed medication/amount re-confirms.
  dangerAdvisoriesAcknowledged = signal(false);
  dangerAdvisories = computed(
    () => this.doseCheckResult()?.advisories.filter((a) => a.type === 'reaction_danger') ?? [],
  );
  nonDangerAdvisories = computed(
    () => this.doseCheckResult()?.advisories.filter((a) => a.type !== 'reaction_danger') ?? [],
  );
  showDangerInterstitial = computed(
    () => this.dangerAdvisories().length > 0 && !this.dangerAdvisoriesAcknowledged(),
  );

  private formEpisodeIds = signal<string[]>([]);
  selectedEpisodeIds = computed(() => this.formEpisodeIds());

  /**
   * Only for the pinned "For ⟨name⟩" line, shown when the patient is fixed (compact, correction).
   * It reads the form control, which is not a signal, so it does not follow the patient select —
   * never render it beside one.
   */
  patientName = computed(
    () =>
      this.correction()?.patientName ||
      (this.patients().find((p) => p.id === this.form.getRawValue().patientId)?.fullName ?? null),
  );

  heading = computed(() => {
    const c = this.correction();
    if (c) return c.intervention.type === 'dressing_change' ? 'Correct dressing change' : 'Correct dose';
    return this.compact() ? 'Log dose' : 'Log Intervention';
  });

  /**
   * A dose logged from a schedule: its schedule link and its dose source are both fixed, and the
   * API refuses any `doseSource` on it (FIELD_NOT_CORRECTABLE).
   */
  isScheduledCorrection = computed(() => {
    const iv = this.correction()?.intervention;
    if (!iv) return false;
    const m: any = iv.metadata ?? {};
    return !!(iv.scheduleId || m.interventionScheduleId || m.doseSource === 'schedule');
  });

  form = this.fb.nonNullable.group({
    patientId: ['', Validators.required],
    performedAt: [this.defaultDateTime(), Validators.required],
    type: this.fb.control<InterventionType>('medication_dose', { nonNullable: true }),
    episodeSelection: this.fb.control<string[]>([], { nonNullable: true }),
    resolveSelected: [false],
    startEpisodeName: [''],
    medicationId: [''],
    medicationEmbodimentId: [''],
    doseSource: ['override'],
    amountMg: [null as number | null],
    amountMl: [null as number | null],
    pillCount: [null as number | null],
    weightKgUsed: [null as number | null],
    ageMonthsUsed: [null as number | null],
    guidelineId: [''],
    interventionScheduleId: [''],
    bodyLocation: [''],
    side: ['n/a'],
    dressingType: [''],
    notes: [''],
  });

  ngOnInit(): void {
    const correction = this.correction();
    if (correction) {
      this.form.valueChanges.pipe(debounceTime(400)).subscribe(() => this.maybeRunDoseCheck());
      this.startCorrection(correction);
      return;
    }
    const params = this.route.snapshot.queryParamMap;
    this.scheduleIdParam = params.get('scheduleId');
    this.patientIdParam = params.get('patientId');
    if (this.patientIdParam) this.form.patchValue({ patientId: this.patientIdParam });
    if (params.get('type') === 'dressing_change') this.form.patchValue({ type: 'dressing_change' });
    this.compact.set(params.get('compact') === '1' && !!this.patientIdParam);

    const medicationId = params.get('medicationId');
    if (medicationId) {
      const amountMg = params.get('amountMg');
      const amountMl = params.get('amountMl');
      this.prefill = {
        medicationId,
        embodimentId: params.get('embodimentId') ?? undefined,
        amountMg: amountMg === null ? undefined : Number(amountMg),
        amountMl: amountMl === null ? undefined : Number(amountMl),
        doseSource: this.readDoseSourceParam(params.get('doseSource')),
      };
    }
    this.form.valueChanges.pipe(debounceTime(400)).subscribe(() => this.maybeRunDoseCheck());

    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.afterAuthReady(),
        error: () => this.auth.logout(),
      });
    } else {
      this.afterAuthReady();
    }
  }

  private afterAuthReady(): void {
    this.loadPatients();
    if (this.scheduleIdParam) {
      this.prefillFromSchedule(this.scheduleIdParam);
    }
    if (this.patientIdParam) {
      this.loadEpisodes(this.patientIdParam);
    }
    this.applyRecentPrefill();
  }

  /**
   * "Same as last time" — medication, embodiment and amount, straight off this patient's last dose
   * of it (`GET /patients/:id/recent-medications`). It fills fields and nothing else: the dose
   * check still runs on the patched values, both guidance cards still render side by side, the
   * advisory banners and the `reaction_danger` interstitial still fire, and the caregiver still
   * reviews before saving (P1 — guardrails, not gates).
   */
  private applyRecentPrefill(): void {
    const prefill = this.prefill;
    if (!prefill?.medicationId) return;
    this.form.patchValue({
      type: 'medication_dose',
      amountMg: prefill.amountMg ?? null,
      amountMl: prefill.amountMl ?? null,
      // The source travels with the amount. Repeating a weight-based dose is still arriving at it
      // from the weight-based guideline, and leaving the form's `override` default in place would
      // record every repeat as an ad-hoc deviation and flag it atypical for it — a false signal
      // manufactured by the shortcut (frontend.md → Home). Absent param keeps the default.
      ...(prefill.doseSource ? { doseSource: prefill.doseSource } : {}),
    });
    this.loadMedicationForSchedule(prefill.medicationId, prefill.embodimentId ?? null);
  }

  /**
   * `?doseSource=` off a repeat/recents prefill, validated against the enum.
   *
   * `'schedule'` deliberately degrades to `'override'`: this dose is not executing the standing
   * schedule (no `interventionScheduleId` rides along with a repeat), and recording it as one
   * would misstate its provenance in the ER Brief. The atypical exemption keys on the scheduleId
   * rather than on this value, so the degradation costs nothing but honesty (api.md → Interventions).
   */
  private readDoseSourceParam(raw: string | null): DoseSource | undefined {
    if (!raw || !DOSE_SOURCES.includes(raw as DoseSource)) return undefined;
    return raw === 'schedule' ? 'override' : (raw as DoseSource);
  }

  private prefillFromSchedule(scheduleId: string): void {
    this.api.get<InterventionSchedule>(`/schedules/${scheduleId}`).subscribe({
      next: (schedule) => {
        this.form.patchValue({
          patientId: schedule.patientId,
          type: schedule.type,
          interventionScheduleId: schedule.id,
          doseSource: 'override',
          amountMg: schedule.doseMg,
          amountMl: schedule.doseMl,
          pillCount: schedule.pillCount,
          bodyLocation: schedule.bodyLocation ?? '',
          side: schedule.side ?? 'n/a',
          dressingType: schedule.dressingType ?? '',
        });
        this.loadEpisodes(schedule.patientId);
        if (schedule.medicationId) {
          this.loadMedicationForSchedule(schedule.medicationId, schedule.medicationEmbodimentId);
        }
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load the schedule to prefill this dose.')),
    });
  }

  private loadMedicationForSchedule(medicationId: string, embodimentId: string | null): void {
    this.api.get<Medication>(`/medications/${medicationId}`).subscribe({
      next: (medication) => {
        this.selectedMedication.set(medication);
        this.form.patchValue({ medicationId: medication.id });
        this.api.get<MedicationEmbodiment[]>(`/medications/${medication.id}/embodiments`).subscribe({
          next: (embodiments) => {
            this.embodiments.set(embodiments);
            if (embodimentId) {
              this.form.patchValue({ medicationEmbodimentId: embodimentId });
            }
          },
          error: () => this.embodiments.set([]),
        });
      },
      error: () => undefined,
    });
  }

  private defaultDateTime() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    return localISOTime;
  }

  isMedication = computed(() => this.form.controls.type.value === 'medication_dose');
  isDressingChange = computed(() => this.form.controls.type.value === 'dressing_change');

  private loadPatients() {
    const user = this.auth.user();
    if (!user) return;
    this.api.get<Patient[]>(`/patients`).subscribe({
      next: (res) => {
        this.patients.set(res);
        if (this.scheduleIdParam || this.patientIdParam) return;
        const current = this.form.getRawValue().patientId;
        const pid = current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          this.loadEpisodes(pid);
        }
      },
      error: (err) => {
        this.error.set(errorText(err, 'Unable to load patients.'));
      },
    });
  }

  private loadEpisodes(patientId: string) {
    this.api.get<EpisodeOption[]>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => {
        this.activeEpisodes.set(eps);
        // A visible default, never a silent inference (P5): exactly one active episode is
        // pre-attached — zero taps — and the chip stays on screen for the caregiver to reject
        // before saving. Two or more, and the app declines to guess which illness this belongs to.
        this.setEpisodeSelection(eps.length === 1 ? [eps[0].id] : []);
      },
      error: () => {
        this.activeEpisodes.set([]);
        this.setEpisodeSelection([]);
      },
    });
  }

  setEpisodeSelection(ids: string[]) {
    this.formEpisodeIds.set(ids);
    this.form.patchValue({
      episodeSelection: this.createNewEpisode() ? [...ids, '__new__'] : ids,
    });
  }

  setCreateNew(checked: boolean) {
    this.createNewEpisode.set(checked);
    if (!checked) this.form.patchValue({ startEpisodeName: '' });
    this.setEpisodeSelection(this.formEpisodeIds());
  }

  private parseList(val: string | null): string[] | undefined {
    if (!val) return undefined;
    const parts = val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length);
    return parts.length ? parts : undefined;
  }

  submit() {
    if (this.correction()) {
      this.submitCorrection();
      return;
    }
    if (this.form.invalid || this.saving()) return;
    const user = this.auth.user();
    if (!user) {
      this.error.set('You must be signed in.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.success.set(false);

    const val = this.form.getRawValue();
    const episodeIds = (val.episodeSelection || []).filter((id) => id !== '__new__');
    const body: CreateInterventionDto = {
      performedAt: new Date(val.performedAt).toISOString(),
      type: val.type,
      startEpisodeName: this.createNewEpisode() ? val.startEpisodeName || undefined : undefined,
      episodeIds: episodeIds.length ? episodeIds : undefined,
      resolvesEpisodeIds: val.resolveSelected && episodeIds.length ? episodeIds : undefined,
      notes: val.notes || undefined,
    };

    if (val.type === 'medication_dose') {
      Object.assign(body, {
        medicationId: val.medicationId || undefined,
        medicationEmbodimentId: val.medicationEmbodimentId || undefined,
        doseSource: val.doseSource as any,
        amountMg: val.amountMg ?? undefined,
        amountMl: val.amountMl ?? undefined,
        pillCount: val.pillCount ?? undefined,
        weightKgUsed: val.weightKgUsed ?? undefined,
        ageMonthsUsed: val.ageMonthsUsed ?? undefined,
        guidelineId: val.guidelineId || undefined,
        interventionScheduleId: val.interventionScheduleId || undefined,
      });
    } else {
      Object.assign(body, {
        bodyLocation: val.bodyLocation || undefined,
        side: val.side as any,
        dressingType: val.dressingType || undefined,
        interventionScheduleId: val.interventionScheduleId || undefined,
      });
    }

    this.api.post(`/patients/${val.patientId}/interventions`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(true);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save intervention.'));
      },
    });
  }

  cancel() {
    if (this.correction()) {
      this.backToEntry();
      return;
    }
    this.router.navigate(['/dashboard']);
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
    this.medicationResults.set([]);
    this.medicationQuery.set('');
    this.form.patchValue({ medicationId: medication.id, medicationEmbodimentId: '' });
    this.embodiments.set([]);
    this.api.get<MedicationEmbodiment[]>(`/medications/${medication.id}/embodiments`).subscribe({
      next: (res) => this.embodiments.set(res),
      error: () => this.embodiments.set([]),
    });
  }

  clearMedication() {
    this.selectedMedication.set(null);
    this.embodiments.set([]);
    this.form.patchValue({ medicationId: '', medicationEmbodimentId: '' });
    this.doseCheckResult.set(null);
    this.dangerAdvisoriesAcknowledged.set(false);
  }

  isExpired(embodiment: MedicationEmbodiment): boolean {
    return !!embodiment.expiresAt && embodiment.expiresAt * 1000 < Date.now();
  }

  private maybeRunDoseCheck() {
    const val = this.form.getRawValue();
    if (val.type !== 'medication_dose' || !val.medicationId || !val.patientId) {
      this.doseCheckResult.set(null);
      return;
    }
    const body: DoseCheckDto = {
      medicationId: val.medicationId,
      medicationEmbodimentId: val.medicationEmbodimentId || undefined,
      amountMg: val.amountMg ?? undefined,
      occurredAt: val.performedAt ? new Date(val.performedAt).toISOString() : undefined,
      // A correction's preview must not count the dose being corrected as its own prior dose —
      // that reads as "too soon since the last dose" against itself. Create sends no such key.
      ...(this.correction() ? { excludeInterventionId: this.correction()!.intervention.id } : {}),
    };
    this.api
      .post<DoseCheckResult, DoseCheckDto>(`/patients/${val.patientId}/dose-checks`, body)
      .subscribe({
        next: (res) => {
          this.doseCheckResult.set(res);
          this.dangerAdvisoriesAcknowledged.set(false);
        },
        error: () => this.doseCheckResult.set(null),
      });
  }

  acknowledgeDangerAdvisories() {
    this.dangerAdvisoriesAcknowledged.set(true);
  }

  hasStaleWeightAdvisory(): boolean {
    return !!this.doseCheckResult()?.advisories.some((a) => a.type === 'stale_weight');
  }

  useWeightBasedAmount() {
    const guidance = this.doseCheckResult()?.guidance.weightBased;
    if (!guidance) return;
    this.form.patchValue({
      amountMg: Math.round(guidance.computedMg * 100) / 100,
      // The engine already rounded this to a drawable syringe volume; don't round it again here.
      // No pillCount: a weight-based guideline has none to offer.
      amountMl: guidance.computedMl,
      doseSource: 'weight_based',
    });
  }

  useAgeBandAmount() {
    const guidance = this.doseCheckResult()?.guidance.ageBand;
    if (!guidance) return;
    this.form.patchValue({
      amountMg: guidance.doseMg,
      amountMl: guidance.doseMl,
      pillCount: guidance.pillCount,
      doseSource: 'age_based',
    });
  }

  // ── Correcting an entry (frontend.md → "Correcting an entry") ──────────────────────────────

  typeLabel(type: InterventionType): string {
    return INTERVENTION_TYPE_LABELS[type] ?? type;
  }

  backToEntry() {
    this.router.navigate(['/interventions', this.correction()!.intervention.id]);
  }

  /** The stored values, in the form's own shape — what "changed" is measured against. */
  private storedFormValues(iv: Intervention) {
    const m: any = iv.metadata ?? {};
    return {
      performedAt: toLocalDateTimeInput(iv.performedAt),
      notes: iv.notes ?? '',
      medicationId: m.medicationId ?? '',
      medicationEmbodimentId: m.medicationEmbodimentId ?? '',
      doseSource: (m.doseSource ?? 'override') as string,
      amountMg: (m.amountMg ?? null) as number | null,
      amountMl: (m.amountMl ?? null) as number | null,
      pillCount: (m.pillCount ?? null) as number | null,
      bodyLocation: m.bodyLocation ?? '',
      side: m.side ?? 'n/a',
      dressingType: m.dressingType ?? '',
    };
  }

  /**
   * Pre-fills the form with the intervention as stored. Patching the form also fires the debounced
   * dose check, so the guidance and banners for the dose as logged appear without a keystroke.
   */
  private startCorrection(c: InterventionCorrectionContext) {
    const iv = c.intervention;
    const stored = this.storedFormValues(iv);
    this.correctionEpisodeOptions.set(c.episodes.options);
    this.formEpisodeIds.set([...c.episodes.selectedIds]);
    this.form.patchValue({
      ...stored,
      patientId: iv.patientId,
      type: iv.type,
      episodeSelection: [...c.episodes.selectedIds],
    });
    if (stored.medicationId) {
      this.loadMedicationForSchedule(stored.medicationId, stored.medicationEmbodimentId || null);
    }
  }

  /**
   * The PATCH body: only the fields the caregiver changed (frontend.md → "Correcting an entry" →
   * Save). Returns a message instead when the form asks for something a correction cannot express
   * — clearing a field the API can only replace.
   */
  correctionBody(): { body: UpdateInterventionDto } | { problem: string } {
    const iv = this.correction()!.intervention;
    const stored = this.storedFormValues(iv);
    const val = this.form.getRawValue();
    const body: UpdateInterventionDto = {};
    const num = (v: number | null | string) => (v === null || v === '' ? null : Number(v));

    if (val.performedAt !== stored.performedAt) body.performedAt = new Date(val.performedAt).toISOString();
    if ((val.notes ?? '') !== stored.notes) body.notes = val.notes ? val.notes : null;

    const episodes = episodeCorrection(this.correction()!.episodes, {
      selectedIds: this.formEpisodeIds(),
      resolvesIds: this.correctionResolvesIds(),
    });
    if (episodes) Object.assign(body, episodes);

    if (iv.type === 'medication_dose') {
      if (!val.medicationId) return { problem: 'Choose a medication for this dose.' };
      if (val.medicationId !== stored.medicationId) body.medicationId = val.medicationId;
      if (val.medicationEmbodimentId !== stored.medicationEmbodimentId) {
        if (!val.medicationEmbodimentId) return { problem: 'Choose which form of the medication was given.' };
        body.medicationEmbodimentId = val.medicationEmbodimentId;
      }
      if (!this.isScheduledCorrection() && val.doseSource !== stored.doseSource) {
        body.doseSource = val.doseSource as CorrectableDoseSource;
      }
      const amountMg = num(val.amountMg);
      if (amountMg !== stored.amountMg) {
        if (amountMg === null) return { problem: 'Enter the amount in mg.' };
        body.amountMg = amountMg;
      }
      const amountMl = num(val.amountMl);
      if (amountMl !== stored.amountMl) body.amountMl = amountMl;
      const pillCount = num(val.pillCount);
      if (pillCount !== stored.pillCount) body.pillCount = pillCount;
    } else {
      if (val.bodyLocation !== stored.bodyLocation) {
        if (!val.bodyLocation.trim()) return { problem: ERROR_SENTENCES.BODY_LOCATION_REQUIRED };
        body.bodyLocation = val.bodyLocation;
      }
      if (val.side !== stored.side) body.side = val.side as UpdateInterventionDto['side'];
      if (val.dressingType !== stored.dressingType) body.dressingType = val.dressingType;
    }
    return { body };
  }

  private submitCorrection() {
    if (this.form.invalid || this.saving()) return;
    const result = this.correctionBody();
    if ('problem' in result) {
      this.error.set(result.problem);
      return;
    }
    // An untouched form sends nothing to rewrite — no request, no empty revision.
    if (!Object.keys(result.body).length) {
      this.backToEntry();
      return;
    }
    const id = this.correction()!.intervention.id;
    this.saving.set(true);
    this.error.set(null);
    this.api.patch<Intervention, UpdateInterventionDto>(`/interventions/${id}`, result.body).subscribe({
      next: () => {
        this.saving.set(false);
        this.backToEntry();
      },
      error: (err) => {
        // The form keeps everything the caregiver typed; only the message changes.
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save the correction.'));
      },
    });
  }

  saveQuickWeight() {
    const kg = this.quickWeightKg();
    const patientId = this.form.getRawValue().patientId;
    if (!kg || !patientId) return;
    this.savingWeight.set(true);
    this.weightError.set(null);
    this.api
      .post(`/patients/${patientId}/observations`, {
        observedAt: new Date().toISOString(),
        entries: [{ type: 'weight', metadata: { kg } }],
      })
      .subscribe({
        next: () => {
          this.savingWeight.set(false);
          this.quickWeightKg.set(null);
          this.maybeRunDoseCheck();
        },
        error: (err) => {
          this.savingWeight.set(false);
          this.weightError.set(errorText(err, 'Could not log the weight.'));
        },
      });
  }
}
