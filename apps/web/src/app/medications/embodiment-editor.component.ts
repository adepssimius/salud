import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MedicationEmbodiment, MedicationUnitType } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { apiErrorCode, errorText } from '../core/error-display';
import { dependentsFrom, dependentsText } from './catalog-dependents';

/** Epoch seconds to the `yyyy-mm-dd` a date input holds, read in local time like the page displays it. */
export function toDateInput(epochSeconds: number | null): string {
  if (epochSeconds == null) return '';
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date input's `yyyy-mm-dd` to the ISO datetime the API takes: local midnight of that day. */
export function fromDateInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toISOString();
}

export interface EmbodimentFormValue {
  label: string;
  unitType: MedicationUnitType;
  concentrationMg: number | null;
  concentrationVolumeMl: number | null;
  strengthMgPerUnit: number | null;
  notes: string;
  expiresAt: string; // yyyy-mm-dd, '' for none
}

const EMPTY: EmbodimentFormValue = {
  label: '',
  unitType: 'tablet',
  concentrationMg: null,
  // Defaults to 1 so the field reads "__ mg per 1 mL" out of the box: the old single-box
  // behaviour, still one number to type, for a label already printed per mL.
  concentrationVolumeMl: 1,
  strengthMgPerUnit: null,
  notes: '',
  expiresAt: '',
};

/** What an existing embodiment looks like in this form. */
function formValueOf(e: MedicationEmbodiment): EmbodimentFormValue {
  // A row stored with the printed pair edits as that pair. One stored only as a per-mL figure (an
  // older row, or one created through the API with concentrationMgPerMl) edits as "N mg per 1 mL",
  // which is the same number; it is only sent if the caregiver changes it.
  const hasPair = e.concentrationMg != null && e.concentrationVolumeMl != null;
  return {
    label: e.label,
    unitType: e.unitType,
    concentrationMg: hasPair ? e.concentrationMg : e.concentrationMgPerMl,
    concentrationVolumeMl: hasPair ? e.concentrationVolumeMl : 1,
    strengthMgPerUnit: e.strengthMgPerUnit,
    notes: e.notes ?? '',
    expiresAt: toDateInput(e.expiresAt),
  };
}

/**
 * One form for adding and editing a concrete form of a medication (an "embodiment": the 160 mg /
 * 5 mL syrup, the 200 mg tablet). It is the only place in the web app that knows the concentration
 * rules, so create and edit cannot drift apart.
 *
 * Concentration is always sent as the printed pair (mg + mL) and never as the per-mL figure, so a
 * request can never carry both (CONCENTRATION_INPUT_CONFLICT). The server does the division.
 *
 * Once a dose or schedule references an embodiment, its concentration, strength and unit type are
 * locked (409 EMBODIMENT_CONCENTRATION_IN_USE): those figures are what past doses were measured
 * against. The answer to "the bottle changed" is a new form, which this offers prefilled.
 */
@Component({
  selector: 'app-embodiment-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <p class="muted small mode-line" *ngIf="!editing() && convertedFromEdit()">
        Adding a new form with these values. The original stays as it was.
      </p>
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
      <label class="field">
        <span>Expires</span>
        <input type="date" formControlName="expiresAt" />
        <span class="muted small">Leave empty if the package has no date.</span>
      </label>
      <label class="field">
        <span>Notes</span>
        <textarea formControlName="notes" rows="2"></textarea>
      </label>

      <div class="error" *ngIf="error()">{{ error() }}</div>
      <ng-container *ngIf="locked()">
        <p class="muted small locked-line" *ngIf="lockedDependents()">{{ lockedDependents() }}</p>
        <button type="button" class="secondary" (click)="addAsNew()">Add as a new form</button>
      </ng-container>

      <div class="editor-actions">
        <button
          type="submit"
          class="primary"
          [disabled]="form.invalid || concentrationPairIncomplete() || busy()"
        >
          {{ saving() ? 'Saving…' : editing() ? 'Save' : 'Add' }}
        </button>
        <button type="button" class="secondary" (click)="cancelled.emit()" [disabled]="busy()">Cancel</button>
      </div>
    </form>

    <div class="danger-zone" *ngIf="editing()">
      <button type="button" class="secondary delete" (click)="remove()" [disabled]="busy()">
        {{ deleting() ? 'Deleting…' : 'Delete this form' }}
      </button>
      <ng-container *ngIf="inUse()">
        <p class="error small">{{ inUse() }}</p>
        <p class="muted small" *ngIf="inUseDependents()">{{ inUseDependents() }}</p>
        <!-- An embodiment has no retire flag. "At home" is what the pickers and the cabinet read,
             so unticking it is the nearest thing to putting the bottle away. -->
        <p class="muted small">
          If you no longer have this one, untick "At home" on it instead — it stays on record for the
          doses that used it.
        </p>
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
      .mode-line,
      .locked-line {
        margin: 0;
      }
      /* A fieldset so the two boxes read as one labelled control; the global .field vocabulary
         styles the legend and spacing, only the row layout is specific to this form. */
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
export class EmbodimentEditorComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) medicationId!: string;
  /** The form being edited; null (the default) adds a new one. */
  @Input() embodiment: MedicationEmbodiment | null = null;

  @Output() saved = new EventEmitter<MedicationEmbodiment>();
  @Output() deleted = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  form = this.fb.nonNullable.group({
    label: ['', Validators.required],
    unitType: ['tablet' as MedicationUnitType, Validators.required],
    concentrationMg: [null as number | null],
    concentrationVolumeMl: [1 as number | null],
    strengthMgPerUnit: [null as number | null],
    notes: [''],
    expiresAt: [''],
  });

  /** The row under edit, or null when adding. A signal so "Add as a new form" can switch modes in place. */
  editing = signal<MedicationEmbodiment | null>(null);
  convertedFromEdit = signal(false);

  saving = signal(false);
  deleting = signal(false);
  busy = computed(() => this.saving() || this.deleting());
  error = signal<string | null>(null);
  locked = signal(false);
  lockedDependents = signal<string | null>(null);
  inUse = signal<string | null>(null);
  inUseDependents = signal<string | null>(null);

  // A signal fed from valueChanges rather than a computed() over `.value`: control values are plain
  // properties, invisible to the reactive graph, so such a computed() would cache forever.
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
    this.form.valueChanges.subscribe(() => this.syncPair());
    this.editing.set(this.embodiment);
    this.form.reset(this.embodiment ? formValueOf(this.embodiment) : EMPTY);
    this.syncPair();
  }

  private syncPair() {
    const val = this.form.getRawValue();
    this.concentrationPair.set({ mg: val.concentrationMg ?? null, ml: val.concentrationVolumeMl ?? null });
  }

  /** The create body. Only the fields the caregiver filled in; JSON drops the undefineds. */
  createBody(): Record<string, unknown> {
    const val = this.form.getRawValue();
    return {
      label: val.label,
      unitType: val.unitType,
      // The pair goes up as typed; the server does the division and stores all three figures.
      // Omitted entirely for a solid form, where "1 mL" would be meaningless.
      concentrationMg: val.concentrationMg ?? undefined,
      concentrationVolumeMl: val.concentrationMg == null ? undefined : (val.concentrationVolumeMl ?? undefined),
      strengthMgPerUnit: val.strengthMgPerUnit ?? undefined,
      notes: val.notes.trim() || undefined,
      expiresAt: fromDateInput(val.expiresAt) ?? undefined,
    };
  }

  /**
   * The PATCH body: only what differs from the stored row. Echoing unchanged concentration values
   * would be harmless to the server, but sending only changes keeps an edit of the label from ever
   * touching the locked fields at all.
   */
  changes(): Record<string, unknown> {
    const original = formValueOf(this.editing()!);
    const val = this.form.getRawValue();
    const body: Record<string, unknown> = {};
    if (val.label !== original.label) body['label'] = val.label;
    if (val.unitType !== original.unitType) body['unitType'] = val.unitType;
    if (val.strengthMgPerUnit !== original.strengthMgPerUnit) body['strengthMgPerUnit'] = val.strengthMgPerUnit;
    const notes = val.notes.trim();
    if (notes !== original.notes.trim()) body['notes'] = notes || null;
    if (val.expiresAt !== original.expiresAt) body['expiresAt'] = fromDateInput(val.expiresAt);

    const mgChanged = val.concentrationMg !== original.concentrationMg;
    // The volume only matters while there is an mg figure: with the mg box empty the volume box is
    // just its default 1, and a change there means nothing.
    const mlChanged = val.concentrationMg != null && val.concentrationVolumeMl !== original.concentrationVolumeMl;
    if (mgChanged || mlChanged) {
      if (val.concentrationMg == null) {
        // Clearing the mg clears the pair and the derived figure together, server-side.
        body['concentrationMg'] = null;
      } else {
        // Always the whole pair, never concentrationMgPerMl: one way in per request.
        body['concentrationMg'] = val.concentrationMg;
        body['concentrationVolumeMl'] = val.concentrationVolumeMl;
      }
    }
    return body;
  }

  save() {
    if (this.form.invalid || this.concentrationPairIncomplete() || this.busy()) return;
    const current = this.editing();
    let request;
    if (current) {
      const body = this.changes();
      if (!Object.keys(body).length) {
        this.cancelled.emit();
        return;
      }
      request = this.api.patch<MedicationEmbodiment, Record<string, unknown>>(`/embodiments/${current.id}`, body);
    } else {
      request = this.api.post<MedicationEmbodiment, Record<string, unknown>>(
        `/medications/${this.medicationId}/embodiments`,
        this.createBody(),
      );
    }
    this.error.set(null);
    this.locked.set(false);
    this.lockedDependents.set(null);
    this.saving.set(true);
    request.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.saved.emit(row);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(
          errorText(err, current ? 'Could not save this form of the medication.' : 'Could not add this form of the medication.'),
        );
        if (apiErrorCode(err) === 'EMBODIMENT_CONCENTRATION_IN_USE') {
          this.locked.set(true);
          this.lockedDependents.set(dependentsText(dependentsFrom(err)));
        }
      },
    });
  }

  /** The same form, switched to adding: every value the caregiver typed stays where it is. */
  addAsNew() {
    this.editing.set(null);
    this.convertedFromEdit.set(true);
    this.locked.set(false);
    this.lockedDependents.set(null);
    this.error.set(null);
    this.inUse.set(null);
    this.inUseDependents.set(null);
  }

  remove() {
    const current = this.editing();
    if (!current || this.busy()) return;
    if (!window.confirm(`Delete "${current.label}"? This cannot be undone.`)) return;
    this.error.set(null);
    this.inUse.set(null);
    this.inUseDependents.set(null);
    this.deleting.set(true);
    this.api.delete<void>(`/embodiments/${current.id}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleted.emit(current.id);
      },
      error: (err) => {
        this.deleting.set(false);
        if (apiErrorCode(err) === 'EMBODIMENT_IN_USE') {
          this.inUse.set(errorText(err, 'This form is still in use.'));
          this.inUseDependents.set(dependentsText(dependentsFrom(err)));
        } else {
          this.error.set(errorText(err, 'Could not delete this form of the medication.'));
        }
      },
    });
  }
}
