import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { GuidelineType, MedicationGuideline } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { apiErrorCode, errorText } from '../core/error-display';
import { dependentsFrom, dependentsText } from './catalog-dependents';

const WEIGHT_ONLY = ['mgPerKg', 'maxMgPerDose', 'minIntervalHours'] as const;
const AGE_ONLY = ['ageMinMonths', 'ageMaxMonths', 'doseMg', 'frequencyPerDay'] as const;
// Every numeric field this form edits. doseMl is the one optional age-band field.
const NUMERIC = [...WEIGHT_ONLY, ...AGE_ONLY, 'doseMl', 'maxMgPerDay'] as const;
type NumericField = (typeof NUMERIC)[number];

/**
 * Adds or edits a dosing guideline, with the fields the catalog has always asked for per type.
 *
 * `type` is fixed once a guideline exists: the API's PATCH does not take it, because a
 * weight-based guideline turned age-band would carry a half-set of the wrong fields. Changing it
 * means deleting and recreating, and the edit form says so rather than offering a select that
 * cannot work.
 */
@Component({
  selector: 'app-guideline-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <label class="field">
        <span>Source</span>
        <input type="text" formControlName="source" placeholder="AAP Clinical Report (2011)" />
      </label>
      <label class="field" *ngIf="!guideline">
        <span>Type</span>
        <select formControlName="type">
          <option value="weight_based">Weight-based</option>
          <option value="age_band">Age-band</option>
        </select>
      </label>
      <div class="field" *ngIf="guideline">
        <span>Type</span>
        <span class="type-text">{{ isWeightBased() ? 'Weight-based' : 'Age-band' }}</span>
        <span class="muted small">To use a different type, delete this guideline and add a new one.</span>
      </div>

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

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <div class="editor-actions">
        <button type="submit" class="primary" [disabled]="form.invalid || busy()">
          {{ saving() ? 'Saving…' : guideline ? 'Save' : 'Add' }}
        </button>
        <button type="button" class="secondary" (click)="cancelled.emit()" [disabled]="busy()">Cancel</button>
      </div>
    </form>

    <div class="danger-zone" *ngIf="guideline">
      <button type="button" class="secondary delete" (click)="remove()" [disabled]="busy()">
        {{ deleting() ? 'Deleting…' : 'Delete guideline' }}
      </button>
      <ng-container *ngIf="inUse()">
        <p class="error small">{{ inUse() }}</p>
        <p class="muted small" *ngIf="inUseDependents()">{{ inUseDependents() }}</p>
      </ng-container>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .type-text {
        font-weight: 600;
      }
      .editor-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }
      .editor-actions button {
        flex: 1 1 8rem;
      }
      .danger-zone {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border-top: 1px solid var(--border);
        padding-top: 0.85rem;
      }
      .danger-zone p {
        margin: 0;
      }
      .delete {
        color: var(--danger-text);
        border-color: var(--danger-border);
      }
    `,
  ],
})
export class GuidelineEditorComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) medicationId!: string;
  /** The guideline being edited; null (the default) adds a new one. */
  @Input() guideline: MedicationGuideline | null = null;

  @Output() saved = new EventEmitter<MedicationGuideline>();
  @Output() deleted = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  form = this.fb.nonNullable.group({
    source: ['', Validators.required],
    type: ['weight_based' as GuidelineType, Validators.required],
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

  // A signal, not `computed(() => this.form.controls.type.value)`. A control's `.value` is a plain
  // property, so a computed() reading it has zero signal dependencies: it evaluates once and caches
  // forever. That once froze the type at weight-based and made the age-band form unreachable.
  guidelineType = signal<GuidelineType>('weight_based');
  isWeightBased = computed(() => this.guidelineType() === 'weight_based');

  saving = signal(false);
  deleting = signal(false);
  busy = computed(() => this.saving() || this.deleting());
  error = signal<string | null>(null);
  inUse = signal<string | null>(null);
  inUseDependents = signal<string | null>(null);

  ngOnInit(): void {
    const g = this.guideline;
    if (g) {
      this.form.reset({
        source: g.source,
        type: g.type,
        mgPerKg: g.mgPerKg,
        maxMgPerDose: g.maxMgPerDose,
        minIntervalHours: g.minIntervalHours,
        ageMinMonths: g.ageMinMonths,
        ageMaxMonths: g.ageMaxMonths,
        doseMg: g.doseMg,
        doseMl: g.doseMl,
        frequencyPerDay: g.frequencyPerDay,
        maxMgPerDay: g.maxMgPerDay,
      });
    }
    this.form.controls.type.valueChanges.subscribe((type) => this.applyType(type));
    this.applyType(this.form.controls.type.value);
  }

  private applyType(type: GuidelineType) {
    const next: GuidelineType = type === 'age_band' ? 'age_band' : 'weight_based';
    this.guidelineType.set(next);
    this.syncValidators(next);
  }

  // Mirrors CreateGuidelineDto's @ValidateIf gates. Without these the form submits blanks, the
  // server 400s, and nothing on screen says why.
  private syncValidators(type: GuidelineType) {
    const apply = (names: readonly string[], required: boolean) => {
      for (const name of names) {
        const control = this.form.get(name);
        if (!control) continue;
        if (required) control.setValidators([Validators.required]);
        else control.clearValidators();
        // emitEvent: false, or updating a control re-enters the valueChanges handler above.
        control.updateValueAndValidity({ emitEvent: false });
      }
    };
    apply(WEIGHT_ONLY, type === 'weight_based');
    apply(AGE_ONLY, type === 'age_band');
  }

  showFieldError(name: string): boolean {
    const control = this.form.get(name);
    return !!control && control.invalid && control.touched;
  }

  /** The fields that belong to this guideline's type, plus the ones both types share. */
  private fieldsForType(): readonly NumericField[] {
    return this.isWeightBased() ? [...WEIGHT_ONLY, 'maxMgPerDay'] : [...AGE_ONLY, 'doseMl', 'maxMgPerDay'];
  }

  createBody(): Record<string, unknown> {
    const val = this.form.getRawValue();
    const body: Record<string, unknown> = { source: val.source, type: val.type };
    for (const field of NUMERIC) body[field] = val[field] ?? undefined;
    return body;
  }

  /** Only what differs from the stored guideline, and only fields its type uses. */
  changes(): Record<string, unknown> {
    const g = this.guideline!;
    const val = this.form.getRawValue();
    const body: Record<string, unknown> = {};
    if (val.source.trim() !== g.source) body['source'] = val.source.trim();
    for (const field of this.fieldsForType()) {
      if ((val[field] ?? null) !== (g[field] ?? null)) body[field] = val[field];
    }
    return body;
  }

  save() {
    if (this.form.invalid || this.busy()) return;
    const current = this.guideline;
    let request;
    if (current) {
      const body = this.changes();
      if (!Object.keys(body).length) {
        this.cancelled.emit();
        return;
      }
      request = this.api.patch<MedicationGuideline, Record<string, unknown>>(`/guidelines/${current.id}`, body);
    } else {
      request = this.api.post<MedicationGuideline, Record<string, unknown>>(
        `/medications/${this.medicationId}/guidelines`,
        this.createBody(),
      );
    }
    this.error.set(null);
    this.saving.set(true);
    request.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.saved.emit(row);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, current ? 'Could not save this guideline.' : 'Could not add this guideline.'));
      },
    });
  }

  remove() {
    const current = this.guideline;
    if (!current || this.busy()) return;
    if (!window.confirm(`Delete this guideline from ${current.source}? This cannot be undone.`)) return;
    this.error.set(null);
    this.inUse.set(null);
    this.inUseDependents.set(null);
    this.deleting.set(true);
    this.api.delete<void>(`/guidelines/${current.id}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleted.emit(current.id);
      },
      error: (err) => {
        this.deleting.set(false);
        if (apiErrorCode(err) === 'GUIDELINE_IN_USE') {
          this.inUse.set(errorText(err, 'This guideline is still in use.'));
          this.inUseDependents.set(dependentsText(dependentsFrom(err)));
        } else {
          this.error.set(errorText(err, 'Could not delete this guideline.'));
        }
      },
    });
  }
}
