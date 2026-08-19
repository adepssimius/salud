import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { Medication, MedicationEmbodiment, MedicationGuideline } from '@salud/shared/types';
import { errorText } from '../core/error-display';
import { concentrationText } from '../core/concentration-display';

@Component({
  selector: 'app-medication-detail-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <!-- Outside the *ngIf below, deliberately: a load failure leaves medication() null, and
         rendering nothing at all is the exact defect frontend.md names ("an unreachable API must
         say so"). Three states -- loading, failed, loaded -- must be distinguishable. -->
    <div class="card" *ngIf="!medication()">
      <button type="button" class="link" (click)="backToList()">&larr; Medications</button>
      <div class="error" *ngIf="loadError()">{{ loadError() }}</div>
      <p class="muted" *ngIf="!loadError()">Loading…</p>
    </div>

    <div class="card" *ngIf="medication() as med">
      <button type="button" class="link" (click)="backToList()">&larr; Medications</button>
      <h1>{{ med.name }}</h1>
      <p class="muted" *ngIf="med.brandNames.length">Also known as: {{ med.brandNames.join(', ') }}</p>
      <p class="muted" *ngIf="med.description">{{ med.description }}</p>
      <div class="med-tags" *ngIf="med.tags.length">
        <span class="pill" *ngFor="let t of med.tags">{{ t }}</span>
      </div>

      <section>
        <h2>Embodiments</h2>
        <div class="error" *ngIf="embodimentsError()">{{ embodimentsError() }}</div>
        <div class="error" *ngIf="cabinetError()">{{ cabinetError() }}</div>
        <ul class="emb-list">
          <li *ngFor="let e of embodiments()">
            <div class="emb-header">
              <strong>{{ e.label }}</strong>
              <span class="pill">{{ e.unitType }}</span>
            </div>
            <div class="emb-details muted">
              <span *ngIf="concentrationText(e) as conc">{{ conc }}</span>
              <span *ngIf="e.strengthMgPerUnit">{{ e.strengthMgPerUnit }} mg/unit</span>
            </div>
            <div class="cabinet-row">
              <label class="inline-check">
                <input type="checkbox" [checked]="e.atHome" (change)="toggleAtHome(e, $event)" />
                <span>At home</span>
              </label>
              <label class="inline-check">
                <input type="checkbox" [checked]="e.runningLow" (change)="toggleRunningLow(e, $event)" />
                <span>Running low</span>
              </label>
              <span class="muted small" *ngIf="e.expiresAt">
                Expires {{ e.expiresAt * 1000 | date: 'mediumDate' }}
              </span>
            </div>
          </li>
        </ul>
        <button type="button" class="secondary" (click)="toggleEmbodimentForm()">
          {{ showEmbodimentForm() ? 'Cancel' : '+ Add embodiment' }}
        </button>
        <form *ngIf="showEmbodimentForm()" [formGroup]="embodimentForm" (ngSubmit)="createEmbodiment()">
          <label class="field">
            <span>Label</span>
            <input type="text" formControlName="label" placeholder="500 mg tablet" />
          </label>
          <label class="field">
            <span>Unit type</span>
            <select formControlName="unitType">
              <option value="tablet">Tablet</option>
              <option value="capsule">Capsule</option>
              <option value="ml">mL (liquid)</option>
              <option value="drop">Drop</option>
              <option value="other">Other</option>
            </select>
          </label>
          <!-- Two boxes, not one. The bottle says "160 mg per 5 mL"; asking for 32 mg/mL asks the
               caregiver to divide, which is where the transcription errors are. The volume box
               defaults to 1, so a label that really does read "20 mg/mL" is still one number.
               The derived figure is shown live because the app does not hide arithmetic it did on
               a caregiver's behalf (frontend.md -> "Medication catalog"). -->
          <fieldset class="field conc-field">
            <legend>Concentration (for liquids)</legend>
            <div class="conc-inputs">
              <input
                type="number"
                step="0.01"
                formControlName="concentrationMg"
                aria-label="Concentration amount in mg"
                placeholder="160"
              />
              <span class="conc-unit">mg per</span>
              <input
                type="number"
                step="0.01"
                formControlName="concentrationVolumeMl"
                aria-label="Concentration volume in mL"
              />
              <span class="conc-unit">mL</span>
            </div>
            <p class="muted small conc-derived" *ngIf="derivedConcentration() as derived">= {{ derived }} mg/mL</p>
            <p class="error small" *ngIf="concentrationPairIncomplete()">
              Fill in both numbers — how many mg, and in how many mL.
            </p>
          </fieldset>
          <label class="field">
            <span>Strength (mg/unit, for tablets)</span>
            <input type="number" step="0.01" formControlName="strengthMgPerUnit" />
          </label>
          <button
            type="submit"
            class="primary"
            [disabled]="embodimentForm.invalid || concentrationPairIncomplete() || embodimentSaving()"
          >
            {{ embodimentSaving() ? 'Saving…' : 'Add' }}
          </button>
          <div class="error" *ngIf="embodimentError()">{{ embodimentError() }}</div>
        </form>
      </section>

      <section>
        <h2>Guidelines</h2>
        <div class="error" *ngIf="guidelinesError()">{{ guidelinesError() }}</div>
        <ul class="guideline-list">
          <li *ngFor="let g of guidelines()">
            <div class="guideline-header">
              <span class="pill">{{ g.type === 'weight_based' ? 'Weight-based' : 'Age-band' }}</span>
              <span class="muted small">{{ g.source }}</span>
            </div>
            <div class="guideline-details muted" *ngIf="g.type === 'weight_based'">
              {{ g.mgPerKg }} mg/kg — max {{ g.maxMgPerDose }} mg/dose, {{ g.maxMgPerDay }} mg/day, every
              {{ g.minIntervalHours }}h
            </div>
            <div class="guideline-details muted" *ngIf="g.type === 'age_band'">
              {{ g.ageMinMonths }}–{{ g.ageMaxMonths }} mo — {{ g.doseMg }} mg ({{ g.doseMl }} mL),
              {{ g.frequencyPerDay }}x/day, max {{ g.maxMgPerDay }} mg/day
            </div>
          </li>
        </ul>
        <button type="button" class="secondary" (click)="toggleGuidelineForm()">
          {{ showGuidelineForm() ? 'Cancel' : '+ Add guideline' }}
        </button>
        <form *ngIf="showGuidelineForm()" [formGroup]="guidelineForm" (ngSubmit)="createGuideline()">
          <label class="field">
            <span>Source</span>
            <input type="text" formControlName="source" placeholder="AAP Clinical Report (2011)" />
          </label>
          <label class="field">
            <span>Type</span>
            <select formControlName="type">
              <option value="weight_based">Weight-based</option>
              <option value="age_band">Age-band</option>
            </select>
          </label>

          <ng-container *ngIf="isWeightBased()">
            <label class="field">
              <span>mg/kg</span>
              <input type="number" step="0.01" formControlName="mgPerKg" />
            </label>
            <label class="field">
              <span>Max mg/dose</span>
              <input type="number" step="0.01" formControlName="maxMgPerDose" />
            </label>
            <label class="field">
              <span>Min interval (hours)</span>
              <input type="number" step="0.5" formControlName="minIntervalHours" />
            </label>
          </ng-container>

          <ng-container *ngIf="!isWeightBased()">
            <label class="field">
              <span>Age min (months)</span>
              <input type="number" formControlName="ageMinMonths" />
            </label>
            <label class="field">
              <span>Age max (months)</span>
              <input type="number" formControlName="ageMaxMonths" />
            </label>
            <label class="field">
              <span>Dose (mg)</span>
              <input type="number" step="0.01" formControlName="doseMg" />
            </label>
            <label class="field">
              <span>Dose (mL, optional)</span>
              <input type="number" step="0.01" formControlName="doseMl" />
            </label>
            <label class="field">
              <span>Frequency per day</span>
              <input type="number" formControlName="frequencyPerDay" />
            </label>
          </ng-container>

          <label class="field">
            <span>Max mg/day</span>
            <input type="number" step="0.01" formControlName="maxMgPerDay" />
            <span class="error small" *ngIf="showFieldError('maxMgPerDay')">Required for both guideline types.</span>
          </label>

          <button type="submit" class="primary" [disabled]="guidelineForm.invalid || guidelineSaving()">
            {{ guidelineSaving() ? 'Saving…' : 'Add' }}
          </button>
          <div class="error" *ngIf="guidelineError()">{{ guidelineError() }}</div>
        </form>
      </section>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      h2 {
        font-size: 1.1rem;
      }
      .link {
        align-self: flex-start;
      }
      .med-tags {
        display: flex;
        gap: 0.35rem;
      }
      section {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .emb-list,
      .guideline-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .emb-list li,
      .guideline-list li {
        padding: 0.6rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .emb-header,
      .guideline-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .emb-details,
      .guideline-details {
        margin-top: 0.25rem;
        font-size: 0.9rem;
        display: flex;
        gap: 0.75rem;
      }
      /* A fieldset so the two boxes read as one labelled control; the global .field vocabulary
         styles the legend and spacing, only the row layout is specific to this page. */
      .conc-field {
        border: none;
        padding: 0;
        margin: 0;
        /* A fieldset's default min-inline-size is min-content, so it refuses to shrink and pushes
           the trailing "mL" outside the card on a phone. Only this reset stops that. */
        min-width: 0;
      }
      .conc-inputs {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .conc-inputs input {
        /* A number input's default size is ~20 characters; without a basis of 0 the two boxes
           together overflow a narrow screen. */
        flex: 1 1 0;
        min-width: 0;
        width: 100%;
      }
      .conc-unit {
        white-space: nowrap;
        color: var(--text-muted);
      }
      .conc-derived {
        margin: 0.35rem 0 0;
      }
      .cabinet-row {
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      form {
        margin-top: 0.4rem;
      }
      .primary,
      .secondary {
        align-self: flex-start;
      }
    `,
  ],
})
export class MedicationDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  medicationId = this.route.snapshot.paramMap.get('id')!;

  medication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);
  guidelines = signal<MedicationGuideline[]>([]);

  showEmbodimentForm = signal(false);
  showGuidelineForm = signal(false);

  loadError = signal<string | null>(null);
  embodimentsError = signal<string | null>(null);
  guidelinesError = signal<string | null>(null);
  cabinetError = signal<string | null>(null);
  embodimentSaving = signal(false);
  embodimentError = signal<string | null>(null);
  guidelineSaving = signal(false);
  guidelineError = signal<string | null>(null);

  embodimentForm = this.fb.nonNullable.group({
    label: ['', Validators.required],
    unitType: ['tablet', Validators.required],
    concentrationMg: [null as number | null],
    // Defaults to 1 so the field reads "__ mg per 1 mL" out of the box: the old single-box
    // behaviour, still one number to type, for a label already printed per mL.
    concentrationVolumeMl: [1 as number | null],
    strengthMgPerUnit: [null as number | null],
  });

  guidelineForm = this.fb.nonNullable.group({
    source: ['', Validators.required],
    type: ['weight_based', Validators.required],
    mgPerKg: [null as number | null],
    maxMgPerDose: [null as number | null],
    minIntervalHours: [null as number | null],
    ageMinMonths: [null as number | null],
    ageMaxMonths: [null as number | null],
    doseMg: [null as number | null],
    doseMl: [null as number | null],
    frequencyPerDay: [null as number | null],
    // Required for both guideline types server-side (CreateGuidelineDto), and the reported
    // hole: with no validator here the form submitted blank, 400'd, and did nothing visible.
    maxMgPerDay: [null as number | null, Validators.required],
  });

  // A signal, not `computed(() => this.guidelineForm.controls.type.value)`. A control's `.value` is
  // a plain property, so a computed() reading it has zero signal dependencies: it evaluates once
  // and caches forever. That froze isWeightBased at true, which meant choosing "Age-band" never
  // swapped the fields and the age-band form was unreachable through the UI entirely.
  guidelineType = signal<'weight_based' | 'age_band'>('weight_based');
  isWeightBased = computed(() => this.guidelineType() === 'weight_based');

  // Same reason the guideline type above is a signal rather than a computed() over `.value`:
  // control values are plain properties, invisible to the reactive graph. Fed from valueChanges.
  private concentrationPair = signal<{ mg: number | null; ml: number | null }>({ mg: null, ml: 1 });

  // The mg/mL the server will derive from what is typed so far — null while the pair is unusable,
  // so the template shows nothing rather than "= Infinity mg/mL" mid-keystroke.
  derivedConcentration = computed(() => {
    const { mg, ml } = this.concentrationPair();
    if (mg == null || ml == null || !(ml > 0) || !(mg > 0)) return null;
    return Math.round((mg / ml) * 1e6) / 1e6;
  });

  // The client-side twin of CONCENTRATION_PAIR_INCOMPLETE: say so at the field rather than letting
  // the caregiver submit and read it back as a form-level error.
  //
  // Only the mg-without-volume direction is a problem. The volume box ships pre-filled with 1, so
  // "empty mg, 1 mL" is just the untouched form -- a tablet must not be nagged about a
  // concentration it doesn't have, and nothing is posted from that state anyway.
  concentrationPairIncomplete = computed(() => {
    const { mg, ml } = this.concentrationPair();
    return mg != null && ml == null;
  });

  ngOnInit(): void {
    this.embodimentForm.valueChanges.subscribe((val) => {
      this.concentrationPair.set({ mg: val.concentrationMg ?? null, ml: val.concentrationVolumeMl ?? null });
    });
    this.guidelineForm.controls.type.valueChanges.subscribe((type) => {
      const next = (type === 'age_band' ? 'age_band' : 'weight_based') as 'weight_based' | 'age_band';
      this.guidelineType.set(next);
      this.syncGuidelineValidators(next);
    });
    this.syncGuidelineValidators('weight_based');
    this.load();
  }

  // Mirrors CreateGuidelineDto's @ValidateIf gates. Without these the form submits blanks, the
  // server 400s, and (before the error handling below) nothing at all happened on screen.
  private syncGuidelineValidators(type: 'weight_based' | 'age_band') {
    const weightOnly = ['mgPerKg', 'maxMgPerDose', 'minIntervalHours'] as const;
    const ageOnly = ['ageMinMonths', 'ageMaxMonths', 'doseMg', 'frequencyPerDay'] as const;
    const apply = (names: readonly string[], required: boolean) => {
      for (const name of names) {
        const control = this.guidelineForm.get(name);
        if (!control) continue;
        if (required) control.setValidators([Validators.required]);
        else control.clearValidators();
        // emitEvent: false, or updating a control re-enters the valueChanges handler above.
        control.updateValueAndValidity({ emitEvent: false });
      }
    };
    apply(weightOnly, type === 'weight_based');
    apply(ageOnly, type === 'age_band');
  }

  concentrationText = concentrationText;

  showFieldError(name: string): boolean {
    const control = this.guidelineForm.get(name);
    return !!control && control.invalid && control.touched;
  }

  private load() {
    this.loadError.set(null);
    this.api.get<Medication>(`/medications/${this.medicationId}`).subscribe({
      next: (m) => this.medication.set(m),
      error: (err) => this.loadError.set(errorText(err, 'Unable to load this medication.')),
    });
    // Their own signals rather than loadError: a failed guidelines fetch should still leave the
    // header and the rest of the page readable, and say so in its own section.
    this.embodimentsError.set(null);
    this.api.get<MedicationEmbodiment[]>(`/medications/${this.medicationId}/embodiments`).subscribe({
      next: (e) => this.embodiments.set(e),
      error: (err) => this.embodimentsError.set(errorText(err, 'Could not load the forms of this medication.')),
    });
    this.guidelinesError.set(null);
    this.api.get<MedicationGuideline[]>(`/medications/${this.medicationId}/guidelines`).subscribe({
      next: (g) => this.guidelines.set(g),
      error: (err) => this.guidelinesError.set(errorText(err, 'Could not load the dosing guidelines.')),
    });
  }

  backToList() {
    this.router.navigate(['/medications']);
  }

  toggleEmbodimentForm() {
    this.embodimentError.set(null);
    this.showEmbodimentForm.set(!this.showEmbodimentForm());
  }

  toggleGuidelineForm() {
    this.guidelineError.set(null);
    this.showGuidelineForm.set(!this.showGuidelineForm());
  }

  toggleAtHome(embodiment: MedicationEmbodiment, event: Event) {
    this.patchCabinet(embodiment, { atHome: (event.target as HTMLInputElement).checked });
  }

  toggleRunningLow(embodiment: MedicationEmbodiment, event: Event) {
    this.patchCabinet(embodiment, { runningLow: (event.target as HTMLInputElement).checked });
  }

  /**
   * Optimistic, with a real rollback. A failed PATCH used to leave the checkbox visually checked
   * while the server said otherwise — on `runningLow` that means the shopping list silently
   * disagrees with the screen.
   *
   * The rollback replaces the whole array rather than mutating a row: the DOM `checked` property
   * has already been changed by the user's click, and Angular won't rewrite a binding whose value
   * it believes is unchanged.
   */
  private patchCabinet(embodiment: MedicationEmbodiment, changes: Partial<MedicationEmbodiment>) {
    const previous = this.embodiments();
    this.cabinetError.set(null);
    this.embodiments.set(previous.map((e) => (e.id === embodiment.id ? { ...e, ...changes } : e)));

    this.api.patch<MedicationEmbodiment, any>(`/embodiments/${embodiment.id}`, changes).subscribe({
      // Replace the row from the response rather than re-running load(): three requests to confirm
      // one boolean is wasteful and visibly flickers.
      next: (updated) =>
        this.embodiments.set(this.embodiments().map((e) => (e.id === updated.id ? updated : e))),
      error: (err) => {
        this.embodiments.set([...previous]);
        this.cabinetError.set(errorText(err, 'Could not update the cabinet status.'));
      },
    });
  }

  createEmbodiment() {
    if (this.embodimentForm.invalid || this.embodimentSaving()) return;
    this.embodimentError.set(null);
    this.embodimentSaving.set(true);
    const val = this.embodimentForm.getRawValue();
    this.api
      .post<MedicationEmbodiment, any>(`/medications/${this.medicationId}/embodiments`, {
        label: val.label,
        unitType: val.unitType,
        // The pair goes up as typed; the server does the division and stores all three figures.
        // Omitted entirely for a solid form, where "1 mL" would be meaningless.
        concentrationMg: val.concentrationMg ?? undefined,
        concentrationVolumeMl: val.concentrationMg == null ? undefined : (val.concentrationVolumeMl ?? undefined),
        strengthMgPerUnit: val.strengthMgPerUnit ?? undefined,
      })
      .subscribe({
        next: () => {
          this.embodimentSaving.set(false);
          this.showEmbodimentForm.set(false);
          this.embodimentForm.reset({
            label: '',
            unitType: 'tablet',
            concentrationMg: null,
            concentrationVolumeMl: 1,
            strengthMgPerUnit: null,
          });
          this.load();
        },
        error: (err) => {
          this.embodimentSaving.set(false);
          this.embodimentError.set(errorText(err, 'Could not add this form of the medication.'));
        },
      });
  }

  createGuideline() {
    if (this.guidelineForm.invalid || this.guidelineSaving()) return;
    this.guidelineError.set(null);
    this.guidelineSaving.set(true);
    const val = this.guidelineForm.getRawValue();
    this.api
      .post<MedicationGuideline, any>(`/medications/${this.medicationId}/guidelines`, {
        source: val.source,
        type: val.type,
        mgPerKg: val.mgPerKg ?? undefined,
        maxMgPerDose: val.maxMgPerDose ?? undefined,
        minIntervalHours: val.minIntervalHours ?? undefined,
        ageMinMonths: val.ageMinMonths ?? undefined,
        ageMaxMonths: val.ageMaxMonths ?? undefined,
        doseMg: val.doseMg ?? undefined,
        doseMl: val.doseMl ?? undefined,
        frequencyPerDay: val.frequencyPerDay ?? undefined,
        maxMgPerDay: val.maxMgPerDay ?? undefined,
      })
      .subscribe({
        next: () => {
          this.guidelineSaving.set(false);
          this.showGuidelineForm.set(false);
          this.load();
        },
        error: (err) => {
          this.guidelineSaving.set(false);
          this.guidelineError.set(errorText(err, 'Could not add this guideline.'));
        },
      });
  }
}
