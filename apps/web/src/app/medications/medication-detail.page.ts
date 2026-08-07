import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { Medication, MedicationEmbodiment, MedicationGuideline } from '@salud/shared/types';

@Component({
  selector: 'app-medication-detail-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
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
        <ul class="emb-list">
          <li *ngFor="let e of embodiments()">
            <div class="emb-header">
              <strong>{{ e.label }}</strong>
              <span class="pill">{{ e.unitType }}</span>
            </div>
            <div class="emb-details muted">
              <span *ngIf="e.concentrationMgPerMl">{{ e.concentrationMgPerMl }} mg/mL</span>
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
        <button type="button" class="secondary" (click)="showEmbodimentForm.set(!showEmbodimentForm())">
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
          <label class="field">
            <span>Concentration (mg/mL, for liquids)</span>
            <input type="number" step="0.01" formControlName="concentrationMgPerMl" />
          </label>
          <label class="field">
            <span>Strength (mg/unit, for tablets)</span>
            <input type="number" step="0.01" formControlName="strengthMgPerUnit" />
          </label>
          <button type="submit" class="primary" [disabled]="embodimentForm.invalid">Add</button>
        </form>
      </section>

      <section>
        <h2>Guidelines</h2>
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
        <button type="button" class="secondary" (click)="showGuidelineForm.set(!showGuidelineForm())">
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
          </label>

          <button type="submit" class="primary" [disabled]="guidelineForm.invalid">Add</button>
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
        font-size: 1.1rem;
      }
      .muted {
        color: #cbd5e1;
      }
      .small {
        font-size: 0.85rem;
      }
      .link {
        align-self: flex-start;
        background: none;
        border: none;
        color: #7dd3fc;
        cursor: pointer;
        padding: 0;
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
      .cabinet-row {
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .inline-check {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .pill {
        display: inline-flex;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(34, 211, 238, 0.15);
        border: 1px solid rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
        font-size: 0.75rem;
        font-weight: 700;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        margin-top: 0.4rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      input,
      select {
        padding: 0.6rem 0.7rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .primary,
      .secondary {
        padding: 0.6rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        align-self: flex-start;
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

  embodimentForm = this.fb.nonNullable.group({
    label: ['', Validators.required],
    unitType: ['tablet', Validators.required],
    concentrationMgPerMl: [null as number | null],
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
    maxMgPerDay: [null as number | null],
  });

  isWeightBased = computed(() => this.guidelineForm.controls.type.value === 'weight_based');

  ngOnInit(): void {
    this.load();
  }

  private load() {
    this.api.get<Medication>(`/medications/${this.medicationId}`).subscribe((m) => this.medication.set(m));
    this.api
      .get<MedicationEmbodiment[]>(`/medications/${this.medicationId}/embodiments`)
      .subscribe((e) => this.embodiments.set(e));
    this.api
      .get<MedicationGuideline[]>(`/medications/${this.medicationId}/guidelines`)
      .subscribe((g) => this.guidelines.set(g));
  }

  backToList() {
    this.router.navigate(['/medications']);
  }

  toggleAtHome(embodiment: MedicationEmbodiment, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.api
      .patch<MedicationEmbodiment, any>(`/embodiments/${embodiment.id}`, { atHome: checked })
      .subscribe(() => this.load());
  }

  toggleRunningLow(embodiment: MedicationEmbodiment, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.api
      .patch<MedicationEmbodiment, any>(`/embodiments/${embodiment.id}`, { runningLow: checked })
      .subscribe(() => this.load());
  }

  createEmbodiment() {
    if (this.embodimentForm.invalid) return;
    const val = this.embodimentForm.getRawValue();
    this.api
      .post<MedicationEmbodiment, any>(`/medications/${this.medicationId}/embodiments`, {
        label: val.label,
        unitType: val.unitType,
        concentrationMgPerMl: val.concentrationMgPerMl ?? undefined,
        strengthMgPerUnit: val.strengthMgPerUnit ?? undefined,
      })
      .subscribe(() => {
        this.showEmbodimentForm.set(false);
        this.embodimentForm.reset({ label: '', unitType: 'tablet', concentrationMgPerMl: null, strengthMgPerUnit: null });
        this.load();
      });
  }

  createGuideline() {
    if (this.guidelineForm.invalid) return;
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
      .subscribe(() => {
        this.showGuidelineForm.set(false);
        this.load();
      });
  }
}
