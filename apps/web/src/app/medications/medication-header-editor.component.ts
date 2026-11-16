import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Medication, UpdateMedicationDto } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { apiErrorCode, errorText } from '../core/error-display';
import { dependentsFrom, dependentsText } from './catalog-dependents';

/** Comma-separated text to a list: trimmed, empties dropped. The same rule the catalog's create form uses. */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Edits a catalog medication's own fields: name, brand names, description, tags and whether it is
 * offered when logging doses (`defaultActive`). Also where a medication is deleted -- which the API
 * allows only once nothing references it, so the in-use answer offers retiring it instead.
 *
 * Catalog edits are not revisioned, and a rename deliberately relabels every past dose of this
 * medication: the dose stores the medication's id, not its name.
 */
@Component({
  selector: 'app-medication-header-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <label class="field">
        <span>Name</span>
        <input type="text" formControlName="name" autocomplete="off" />
        <span class="error small" *ngIf="nameError()">{{ nameError() }}</span>
      </label>
      <label class="field">
        <span>Brand names (comma-separated)</span>
        <input type="text" formControlName="brandNames" placeholder="Tylenol, Panadol" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea formControlName="description" rows="2"></textarea>
      </label>
      <label class="field">
        <span>Tags (comma-separated)</span>
        <input type="text" formControlName="tags" placeholder="antipyretic, analgesic" />
      </label>
      <!-- Standing, not counted: reactions are recorded per patient while the catalog is shared by
           the household, and no endpoint answers "how many reactions match this tag" across
           patients. So this says what removing a tag can do rather than guessing a number. Never
           blocks the save: fixing a mistyped tag is the common reason to be here. -->
      <p class="muted small" *ngIf="removedTags().length">
        You're removing {{ removedTags().join(', ') }}. A reaction recorded against a tag warns on
        every medication that carries it, so this one would stop setting off any such warning.
        That's fine if the tag was a mistake — just check no one's reactions rely on it.
      </p>
      <label class="inline-check">
        <input type="checkbox" formControlName="defaultActive" />
        <span>Active (offered when logging doses)</span>
      </label>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <div class="editor-actions">
        <button type="submit" class="primary" [disabled]="form.invalid || busy()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
        <button type="button" class="secondary" (click)="cancelled.emit()" [disabled]="busy()">Cancel</button>
      </div>
    </form>

    <div class="danger-zone">
      <button type="button" class="secondary delete" (click)="remove()" [disabled]="busy()">
        {{ deleting() ? 'Deleting…' : 'Delete medication' }}
      </button>
      <ng-container *ngIf="inUse()">
        <p class="error small">{{ inUse() }}</p>
        <p class="muted small" *ngIf="dependentsLine()">{{ dependentsLine() }}</p>
        <button
          type="button"
          class="secondary"
          *ngIf="medication.defaultActive"
          (click)="markInactive()"
          [disabled]="busy()"
        >
          Mark inactive instead
        </button>
        <p class="muted small" *ngIf="!medication.defaultActive">
          It is already inactive, so it isn't offered when logging doses.
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
      .editor-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }
      /* Full width at phone size: two equal thumb targets rather than two small ones at the left. */
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
export class MedicationHeaderEditorComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) medication!: Medication;

  @Output() saved = new EventEmitter<Medication>();
  @Output() deleted = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    brandNames: [''],
    description: [''],
    tags: [''],
    defaultActive: [true],
  });

  saving = signal(false);
  deleting = signal(false);
  busy = computed(() => this.saving() || this.deleting());
  error = signal<string | null>(null);
  nameError = signal<string | null>(null);
  inUse = signal<string | null>(null);
  dependentsLine = signal<string | null>(null);

  // Fed from valueChanges: a control's `.value` is invisible to computed() (see the guideline
  // type note on the detail page).
  private tagsText = signal('');
  removedTags = computed(() => {
    const now = new Set(splitList(this.tagsText()).map((t) => t.toLowerCase()));
    return this.medication.tags.filter((t) => !now.has(t.toLowerCase()));
  });

  ngOnInit(): void {
    const m = this.medication;
    this.form.reset({
      name: m.name,
      brandNames: m.brandNames.join(', '),
      description: m.description ?? '',
      tags: m.tags.join(', '),
      defaultActive: m.defaultActive,
    });
    this.tagsText.set(this.form.controls.tags.value);
    this.form.controls.tags.valueChanges.subscribe((v) => this.tagsText.set(v));
  }

  /** Only what differs from the stored medication; an empty object means nothing changed. */
  changes(): UpdateMedicationDto {
    const m = this.medication;
    const val = this.form.getRawValue();
    const body: UpdateMedicationDto = {};
    const name = val.name.trim();
    if (name !== m.name) body.name = name;
    const brandNames = splitList(val.brandNames);
    if (!sameList(brandNames, m.brandNames)) body.brandNames = brandNames;
    const description = val.description.trim() || null;
    if (description !== (m.description ?? null)) body.description = description;
    const tags = splitList(val.tags);
    if (!sameList(tags, m.tags)) body.tags = tags;
    if (val.defaultActive !== m.defaultActive) body.defaultActive = val.defaultActive;
    return body;
  }

  save() {
    if (this.form.invalid || this.busy()) return;
    const body = this.changes();
    if (!Object.keys(body).length) {
      this.cancelled.emit();
      return;
    }
    this.patch(body);
  }

  markInactive() {
    if (this.busy()) return;
    this.patch({ defaultActive: false });
  }

  private patch(body: UpdateMedicationDto) {
    this.error.set(null);
    this.nameError.set(null);
    this.saving.set(true);
    this.api.patch<Medication, UpdateMedicationDto>(`/medications/${this.medication.id}`, body).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.saved.emit(updated);
      },
      error: (err) => {
        this.saving.set(false);
        const text = errorText(err, 'Could not save this medication.');
        // By the field it is about, so the caregiver's eye lands on the name they need to change.
        if (apiErrorCode(err) === 'MEDICATION_NAME_TAKEN') this.nameError.set(text);
        else this.error.set(text);
      },
    });
  }

  remove() {
    if (this.busy()) return;
    if (!window.confirm(`Delete ${this.medication.name}? This cannot be undone.`)) return;
    this.error.set(null);
    this.inUse.set(null);
    this.dependentsLine.set(null);
    this.deleting.set(true);
    this.api.delete<void>(`/medications/${this.medication.id}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleted.emit(this.medication.id);
      },
      error: (err) => {
        this.deleting.set(false);
        if (apiErrorCode(err) === 'MEDICATION_IN_USE') {
          this.inUse.set(errorText(err, 'This medication is still in use.'));
          this.dependentsLine.set(dependentsText(dependentsFrom(err)));
        } else {
          this.error.set(errorText(err, 'Could not delete this medication.'));
        }
      },
    });
  }
}
