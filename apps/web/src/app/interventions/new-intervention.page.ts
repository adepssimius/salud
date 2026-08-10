import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime } from 'rxjs/operators';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { AdvisoryBannerComponent } from '../core/advisory-banner.component';
import { DangerInterstitialComponent } from '../core/danger-interstitial.component';
import { errorText } from '../core/error-display';
import {
  CreateInterventionDto,
  DoseCheckDto,
  DoseCheckResult,
  InterventionSchedule,
  InterventionType,
  Medication,
  MedicationEmbodiment,
  Patient,
} from '@salud/shared/types';

@Component({
  selector: 'app-new-intervention-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, AdvisoryBannerComponent, DangerInterstitialComponent],
  template: `
    <app-danger-interstitial
      *ngIf="showDangerInterstitial()"
      [advisories]="dangerAdvisories()"
      (proceed)="acknowledgeDangerAdvisories()"
      (backOut)="clearMedication()"
    ></app-danger-interstitial>

    <div class="card">
      <h1>Log Intervention</h1>
      <p class="muted">Record a medication dose or dressing change.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
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

          <label class="field">
            <span>Type</span>
            <select formControlName="type">
              <option value="medication_dose">Medication dose</option>
              <option value="dressing_change">Dressing change</option>
            </select>
          </label>
        </div>

        <div class="grid">
          <label class="field">
            <span>Episodes</span>
            <div class="episode-list">
              <label class="inline-check" *ngFor="let ep of activeEpisodes()">
                <input type="checkbox" [value]="ep.id" (change)="toggleEpisode(ep.id, $event)" />
                <span>{{ ep.name }}</span>
              </label>
              <label class="inline-check">
                <input type="checkbox" [checked]="createNewEpisode()" (change)="toggleCreateNew($event)" />
                <span>Create new episode</span>
              </label>
            </div>
          </label>
          <label class="field inline-check">
            <input type="checkbox" formControlName="resolveSelected" />
            <span>Resolve selected episodes</span>
          </label>
          <label class="field" *ngIf="createNewEpisode()">
            <span>Start new episode (optional)</span>
            <input type="text" formControlName="startEpisodeName" placeholder="e.g. Strep throat" />
          </label>
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
            <label class="field">
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
          <div class="grid">
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
            {{ saving() ? 'Saving…' : 'Save intervention' }}
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
      /* flex-direction is explicit because .field also applies on the combined
         "field inline-check" label and would otherwise stack the box above its text. */
      .episode-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      /* The generic input rule is meant for text fields; undo it for checkboxes. */
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

  private scheduleIdParam: string | null = null;

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<Array<{ id: string; name: string }>>([]);
  createNewEpisode = signal(false);
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
    this.scheduleIdParam = this.route.snapshot.queryParamMap.get('scheduleId');
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
        if (this.scheduleIdParam) return;
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
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => this.activeEpisodes.set(eps),
      error: () => this.activeEpisodes.set([]),
    });
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
    this.router.navigate(['/dashboard']);
  }

  onPatientChange(event: Event) {
    const pid = (event.target as HTMLSelectElement).value;
    if (pid) {
      this.form.patchValue({ patientId: pid });
      this.loadEpisodes(pid);
    }
  }

  toggleEpisode(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const current = new Set(this.form.getRawValue().episodeSelection);
    if (checked) {
      current.add(id);
    } else {
      current.delete(id);
    }
    this.form.patchValue({ episodeSelection: Array.from(current) });
  }

  toggleCreateNew(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.createNewEpisode.set(checked);
    if (checked) {
      const current = new Set(this.form.getRawValue().episodeSelection);
      current.add('__new__');
      this.form.patchValue({ episodeSelection: Array.from(current) });
    } else {
      const current = new Set(this.form.getRawValue().episodeSelection);
      current.delete('__new__');
      this.form.patchValue({ episodeSelection: Array.from(current), startEpisodeName: '' });
    }
  }

  onMedicationQueryChange(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.medicationQuery.set(q);
    if (!q) {
      this.medicationResults.set([]);
      return;
    }
    this.api.get<Medication[]>('/medications', { q }).subscribe({
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
