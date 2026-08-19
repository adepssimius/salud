import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { errorText } from '../core/error-display';
import {
  LengthUnit,
  ObservationType,
  PatientFileSummary,
  TempUnit,
  UploadFileResponse,
  WeightUnit,
} from '@salud/shared/types';

export interface EntryDraft {
  type: ObservationType;
  metadata: any;
}

export type Side = 'left' | 'right' | 'bilateral' | 'n/a';

/**
 * One photographed site within the selected episode — a (bodyLocation, side) group of its photo
 * entries, represented by the group's most recent photo (frontend.md → Photos, F-8.2 v2).
 */
export interface PhotoReferenceGroup {
  /** Stored casing of the group's most recent photo — what a tap prefills. */
  bodyLocation: string;
  side: Side;
  /** The group's most recent photo — the framing to match. */
  fileId: string;
  /** Epoch seconds of that photo. */
  timestamp: number;
  /** Photos at this site in the episode, so an established series announces itself. */
  count: number;
}

/** Grouping identity: location compared trimmed and case-insensitively, side exactly. */
export function photoSiteKey(bodyLocation: string, side: Side): string {
  return `${bodyLocation.trim().toLowerCase()}|${side}`;
}
type TemperatureMethod = 'oral' | 'tympanic' | 'axillary' | 'rectal' | 'temporal' | 'unknown';
type SymptomSeverity = 'mild' | 'moderate' | 'severe';

// The five types that are just "one number plus an optional note" share a single form driven by
// this descriptor, rather than five near-identical template branches.
interface NumberEntryConfig {
  label: string;
  metadataKey: string;
  integer: boolean;
  min?: number;
  max?: number;
  unitKind: 'none' | 'weight' | 'length';
  fixedSuffix?: string;
}

const NUMBER_ENTRIES: Partial<Record<ObservationType, NumberEntryConfig>> = {
  heart_rate: { label: 'Heart rate', metadataKey: 'bpm', integer: true, min: 0, unitKind: 'none', fixedSuffix: 'bpm' },
  respiratory_rate: {
    label: 'Respiratory rate',
    metadataKey: 'breathsPerMin',
    integer: true,
    min: 0,
    unitKind: 'none',
    fixedSuffix: 'breaths/min',
  },
  oxygen_saturation: {
    label: 'Oxygen saturation',
    metadataKey: 'percent',
    integer: true,
    min: 0,
    max: 100,
    unitKind: 'none',
    fixedSuffix: '%',
  },
  weight: { label: 'Weight', metadataKey: 'kg', integer: false, min: 0, unitKind: 'weight' },
  height: { label: 'Height', metadataKey: 'cm', integer: false, min: 0, unitKind: 'length' },
};

const LB_PER_KG = 2.2046226218;
const KG_PER_ST = 6.35029318;
const CM_PER_IN = 2.54;

export function toKg(value: number, unit: WeightUnit): number {
  const kg = unit === 'lb' ? value / LB_PER_KG : unit === 'st' ? value * KG_PER_ST : value;
  return Math.round(kg * 100) / 100;
}

export function toCm(value: number, unit: LengthUnit): number {
  const cm = unit === 'in' ? value * CM_PER_IN : value;
  return Math.round(cm * 10) / 10;
}

@Component({
  selector: 'app-entry-metadata-form',
  standalone: true,
  imports: [CommonModule, FormsModule, PhotoThumbnailComponent],
  template: `
    <div class="entry-builder" [class.compact]="!!lockedType">
      <!-- Compact single-purpose layout: arriving from Quick Log with one verb already chosen, the
           type picker and the builder's framing are noise (frontend.md → Quick Log). -->
      <h3 *ngIf="!lockedType">Add entry</h3>

      <label class="field" *ngIf="!lockedType">
        <span>Type</span>
        <select [(ngModel)]="entryType" name="entryType" (ngModelChange)="onTypeChange($event)">
          <option *ngFor="let t of types" [value]="t">{{ t }}</option>
        </select>
      </label>

      <!-- heart_rate / respiratory_rate / oxygen_saturation / weight / height -->
      <ng-container *ngIf="numberConfig() as cfg">
        <label class="field">
          <span>{{ cfg.label }} ({{ numberUnitLabel() }})</span>
          <input
            type="number"
            [step]="cfg.integer ? 1 : 0.1"
            [(ngModel)]="numberValue"
            name="numberValue"
            inputmode="decimal"
          />
        </label>
        <div class="muted small" *ngIf="numberConversionHint() as hint">{{ hint }}</div>
      </ng-container>

      <ng-container *ngIf="entryType === 'temperature'">
        <div class="row">
          <label class="field grow">
            <span>Temperature</span>
            <input type="number" step="0.1" [(ngModel)]="tempValue" name="tempValue" inputmode="decimal" />
          </label>
          <div class="field">
            <span>Unit</span>
            <div class="segmented">
              <button
                type="button"
                *ngFor="let u of tempUnits"
                [class.active]="tempUnit === u"
                (click)="tempUnit = u"
              >
                °{{ u }}
              </button>
            </div>
          </div>
        </div>
        <label class="field">
          <span>Method</span>
          <select [(ngModel)]="tempMethod" name="tempMethod">
            <option *ngFor="let m of temperatureMethods" [value]="m">{{ m }}</option>
          </select>
        </label>
      </ng-container>

      <ng-container *ngIf="entryType === 'pain_score'">
        <div class="field">
          <span>Pain score</span>
          <div class="pain-scale">
            <button
              type="button"
              *ngFor="let n of painScores"
              [class.active]="painScore === n"
              (click)="painScore = n"
            >
              {{ n }}
            </button>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="entryType === 'lesion_size'">
        <div class="row">
          <label class="field grow">
            <span>Length ({{ lengthUnit() }})</span>
            <input type="number" step="0.1" [(ngModel)]="lesionLength" name="lesionLength" inputmode="decimal" />
          </label>
          <label class="field grow">
            <span>Width ({{ lengthUnit() }})</span>
            <input type="number" step="0.1" [(ngModel)]="lesionWidth" name="lesionWidth" inputmode="decimal" />
          </label>
          <label class="field grow">
            <span>Depth ({{ lengthUnit() }})</span>
            <input type="number" step="0.1" [(ngModel)]="lesionDepth" name="lesionDepth" inputmode="decimal" />
          </label>
        </div>
        <div class="muted small" *ngIf="lesionConversionHint() as hint">{{ hint }}</div>
        <label class="field">
          <span>Body location</span>
          <input type="text" [(ngModel)]="bodyLocation" name="lesionBodyLocation" placeholder="e.g. left forearm" />
        </label>
        <label class="field">
          <span>Side</span>
          <select [(ngModel)]="side" name="lesionSide">
            <option *ngFor="let s of sides" [value]="s">{{ s }}</option>
          </select>
        </label>
      </ng-container>

      <ng-container *ngIf="entryType === 'symptom'">
        <label class="field">
          <span>Symptom</span>
          <input type="text" [(ngModel)]="symptomTag" name="symptomTag" placeholder="e.g. cough" />
        </label>
        <label class="field">
          <span>Severity (optional)</span>
          <select [(ngModel)]="symptomSeverity" name="symptomSeverity">
            <option [ngValue]="null">—</option>
            <option *ngFor="let s of severities" [ngValue]="s">{{ s }}</option>
          </select>
        </label>
      </ng-container>

      <ng-container *ngIf="entryType === 'tag'">
        <label class="field">
          <span>Tag</span>
          <input type="text" [(ngModel)]="tagValue" name="tagValue" placeholder="e.g. poor appetite" />
        </label>
      </ng-container>

      <ng-container *ngIf="entryType === 'note'">
        <label class="field">
          <span>Note</span>
          <textarea rows="3" [(ngModel)]="noteText" name="noteText"></textarea>
        </label>
        <label class="field">
          <span>Symptom label (optional)</span>
          <input type="text" [(ngModel)]="noteSymptom" name="noteSymptom" />
        </label>
      </ng-container>

      <ng-container *ngIf="entryType === 'photo'">
        <!-- One card per photographed site in the episode; a tap picks the framing reference and
             prefills location/side. Untapped, this is purely informational — nothing is
             pre-selected on the caregiver's behalf (frontend.md → Photos, F-8.2 v2). -->
        <div class="framing-refs" *ngIf="referenceGroups.length">
          <span class="muted small">Previous photos in this episode — tap to match framing:</span>
          <div class="ref-strip">
            <button
              type="button"
              class="ref-card"
              *ngFor="let g of referenceGroups"
              [class.active]="isSelectedReference(g)"
              (click)="toggleReference(g)"
            >
              <app-photo-thumbnail [fileId]="g.fileId" [link]="false"></app-photo-thumbnail>
              <span class="ref-label">{{ referenceLabel(g) }}</span>
              <span class="muted small">
                {{ g.timestamp * 1000 | date: 'MMM d' }}<ng-container *ngIf="g.count > 1"> · {{ g.count }} photos</ng-container>
              </span>
            </button>
          </div>
        </div>
        <div class="framing-hint" *ngIf="selectedReference() as ref">
          <span class="muted small">Frame it like this one:</span>
          <app-photo-thumbnail [fileId]="ref.fileId" [large]="true"></app-photo-thumbnail>
        </div>
        <label class="field">
          <span>Photo</span>
          <input type="file" accept="image/*" (change)="onPhotoFileSelected($event)" />
        </label>
        <div class="muted small" *ngIf="photoUploading()">Uploading…</div>
        <div class="error small" *ngIf="photoUploadError()">{{ photoUploadError() }}</div>
        <app-photo-thumbnail *ngIf="photoUploadedFileId() as fid" [fileId]="fid"></app-photo-thumbnail>
        <label class="field">
          <span>Body location</span>
          <input
            type="text"
            [ngModel]="bodyLocation"
            (ngModelChange)="onPhotoLocationInput($event)"
            name="photoBodyLocation"
            placeholder="e.g. left forearm"
          />
        </label>
        <label class="field">
          <span>Side</span>
          <select [ngModel]="side" (ngModelChange)="onPhotoSideInput($event)" name="photoSide">
            <option *ngFor="let s of sides" [value]="s">{{ s }}</option>
          </select>
        </label>
        <label class="field">
          <span>Size ({{ lengthUnit() }}, optional)</span>
          <input type="number" step="0.1" [(ngModel)]="photoSize" name="photoSize" inputmode="decimal" />
        </label>
      </ng-container>

      <!-- document: attach a PDF or image — upload new, or pick one already uploaded
           (a lab import's PDF, an earlier observation's attachment). frontend.md → Documents. -->
      <ng-container *ngIf="entryType === 'document'">
        <div class="field">
          <span>Document</span>
          <div class="segmented">
            <button type="button" [class.active]="documentMode() === 'upload'" (click)="setDocumentMode('upload')">
              Upload new
            </button>
            <button type="button" [class.active]="documentMode() === 'existing'" (click)="setDocumentMode('existing')">
              Choose existing
            </button>
          </div>
        </div>
        <ng-container *ngIf="documentMode() === 'upload'">
          <label class="field">
            <span>File (PDF or image)</span>
            <input type="file" accept="application/pdf,image/*" (change)="onDocumentFileSelected($event)" />
          </label>
          <div class="muted small" *ngIf="documentUploading()">Uploading…</div>
          <div class="muted small" *ngIf="documentUploadedFileId()">Uploaded ✓</div>
        </ng-container>
        <ng-container *ngIf="documentMode() === 'existing'">
          <label class="field">
            <span>Patient's uploaded files</span>
            <select [(ngModel)]="documentExistingFileId" name="documentExistingFileId">
              <option [ngValue]="null">—</option>
              <option *ngFor="let f of patientFiles()" [ngValue]="f.id">
                {{ f.originalName || f.id }} · {{ f.contentType }} · {{ f.createdAt * 1000 | date: 'mediumDate' }}
              </option>
            </select>
          </label>
          <div class="muted small" *ngIf="patientFilesLoaded() && !patientFiles().length">
            No files uploaded for this patient yet.
          </div>
        </ng-container>
        <div class="error small" *ngIf="documentError()">{{ documentError() }}</div>
        <label class="field">
          <span>Label (optional)</span>
          <input type="text" [(ngModel)]="documentLabel" name="documentLabel" placeholder="e.g. After-visit summary" />
        </label>
      </ng-container>

      <label class="field" *ngIf="supportsNote()">
        <span>Note (optional)</span>
        <input type="text" [(ngModel)]="entryNote" name="entryNote" />
      </label>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <button type="button" class="secondary" (click)="add()">Add entry</button>
      <div class="muted small" *ngIf="!lockedType">At least one entry is required.</div>
    </div>
  `,
  styles: [
    `
      .entry-builder {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .entry-builder.compact {
        border-top: none;
        padding-top: 0;
      }
      h3 {
        margin: 0;
      }
      .row {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .grow {
        flex: 1;
        min-width: 6rem;
      }
      .segmented {
        display: flex;
        gap: 0.25rem;
      }
      .segmented button {
        padding: 0.65rem 0.9rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
      }
      .segmented button.active {
        background: rgba(34, 211, 238, 0.15);
        border-color: rgba(34, 211, 238, 0.45);
        color: #7dd3fc;
        font-weight: 700;
      }
      /* Big tap targets — this gets used one-handed, in the dark, holding a sick kid. */
      .pain-scale {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }
      .pain-scale button {
        width: 2.6rem;
        height: 2.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
      }
      .pain-scale button.active {
        background: rgba(34, 211, 238, 0.2);
        border-color: rgba(34, 211, 238, 0.5);
        color: #7dd3fc;
        font-weight: 700;
      }
      .framing-refs {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .ref-strip {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding-bottom: 0.25rem;
      }
      .ref-card {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.5rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
      }
      .ref-card.active {
        background: rgba(34, 211, 238, 0.15);
        border-color: rgba(34, 211, 238, 0.45);
      }
      .ref-label {
        font-size: 0.85rem;
        max-width: 7.5rem;
        text-align: center;
      }
      .framing-hint {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .secondary {
        align-self: flex-start;
      }
    `,
  ],
})
export class EntryMetadataFormComponent implements OnChanges, OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);

  @Input() patientId = '';
  @Input() referenceGroups: PhotoReferenceGroup[] = [];
  /**
   * Set when Quick Log picked the verb: the type is fixed and its picker disappears. Applied once,
   * in ngOnInit — the caregiver is still free to change nothing, since there is nothing to change.
   */
  @Input() lockedType: ObservationType | null = null;

  @Output() typeChange = new EventEmitter<ObservationType>();
  @Output() entryAdded = new EventEmitter<EntryDraft>();

  types: ObservationType[] = [
    'temperature',
    'heart_rate',
    'respiratory_rate',
    'oxygen_saturation',
    'pain_score',
    'weight',
    'height',
    'lesion_size',
    'symptom',
    'note',
    'tag',
    'photo',
    // 'lab_result' is deliberately absent: hand-typing lab rows is the transcription risk the
    // import flow exists to avoid (frontend.md → Documents). The API still accepts the type.
    'document',
  ];
  temperatureMethods: TemperatureMethod[] = ['oral', 'tympanic', 'axillary', 'rectal', 'temporal', 'unknown'];
  sides: Side[] = ['left', 'right', 'bilateral', 'n/a'];
  severities: SymptomSeverity[] = ['mild', 'moderate', 'severe'];
  painScores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  tempUnits: TempUnit[] = ['C', 'F'];

  entryType: ObservationType = 'temperature';
  error = signal<string | null>(null);

  ngOnInit(): void {
    if (this.lockedType) {
      this.entryType = this.lockedType;
      this.onTypeChange(this.lockedType);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Groups are rebuilt objects on every episode refetch — re-point the selection at its site's
    // fresh group, or drop it when the site is gone (episode changed underneath the caregiver).
    if (changes['referenceGroups']) {
      const ref = this.selectedReference();
      if (ref) {
        this.selectedReference.set(this.referenceGroups.find((g) => this.sameSite(g, ref)) ?? null);
      }
    }
  }

  // Shared across the number-driven types
  numberValue: number | null = null;
  entryNote = '';

  // temperature — defaults to the caregiver's preferred scale, but stays toggleable: a borrowed
  // thermometer may read the other one, and the reading should be recorded as it was seen.
  // Resolved on read rather than snapshotted at construction: on a cold load the component is
  // built before `auth.me()` resolves, so a field initializer would always fall back to 'C'.
  // An explicit toggle sticks for the rest of the session (same thermometer, same scale).
  tempValue: number | null = null;
  tempMethod: TemperatureMethod = 'unknown';
  private tempUnitOverride: TempUnit | null = null;

  get tempUnit(): TempUnit {
    return this.tempUnitOverride ?? this.auth.user()?.preferredTempUnit ?? 'C';
  }
  set tempUnit(unit: TempUnit) {
    this.tempUnitOverride = unit;
  }

  painScore: number | null = null;

  lesionLength: number | null = null;
  lesionWidth: number | null = null;
  lesionDepth: number | null = null;

  // shared by lesion_size and photo
  bodyLocation = '';
  side: Side = 'n/a';

  selectedReference = signal<PhotoReferenceGroup | null>(null);

  symptomTag = '';
  symptomSeverity: SymptomSeverity | null = null;
  tagValue = '';
  noteText = '';
  noteSymptom = '';

  photoSize: number | null = null;
  photoUploading = signal(false);
  photoUploadedFileId = signal<string | null>(null);
  photoUploadError = signal<string | null>(null);

  documentMode = signal<'upload' | 'existing'>('upload');
  documentUploading = signal(false);
  documentUploadedFileId = signal<string | null>(null);
  documentError = signal<string | null>(null);
  documentExistingFileId: string | null = null;
  documentLabel = '';
  patientFiles = signal<PatientFileSummary[]>([]);
  patientFilesLoaded = signal(false);

  numberConfig(): NumberEntryConfig | null {
    return NUMBER_ENTRIES[this.entryType] ?? null;
  }

  weightUnit = (): WeightUnit => this.auth.user()?.preferredWeightUnit ?? 'kg';
  lengthUnit = (): LengthUnit => this.auth.user()?.preferredLengthUnit ?? 'cm';

  numberUnitLabel(): string {
    const cfg = this.numberConfig();
    if (!cfg) return '';
    if (cfg.unitKind === 'weight') return this.weightUnit();
    if (cfg.unitKind === 'length') return this.lengthUnit();
    return cfg.fixedSuffix ?? '';
  }

  // Shows what will actually be stored when the caregiver is entering a non-canonical unit, so the
  // conversion is never a silent surprise on the timeline later.
  numberConversionHint(): string | null {
    const cfg = this.numberConfig();
    if (!cfg || this.numberValue === null || isNaN(Number(this.numberValue))) return null;
    const value = Number(this.numberValue);
    if (cfg.unitKind === 'weight' && this.weightUnit() !== 'kg') {
      return `= ${toKg(value, this.weightUnit())} kg`;
    }
    if (cfg.unitKind === 'length' && this.lengthUnit() !== 'cm') {
      return `= ${toCm(value, this.lengthUnit())} cm`;
    }
    return null;
  }

  lesionConversionHint(): string | null {
    if (this.lengthUnit() === 'cm') return null;
    const parts = [this.lesionLength, this.lesionWidth, this.lesionDepth]
      .filter((v) => v !== null && !isNaN(Number(v)))
      .map((v) => toCm(Number(v), this.lengthUnit()));
    if (!parts.length) return null;
    return `= ${parts.join(' × ')} cm`;
  }

  supportsNote(): boolean {
    return this.entryType !== 'note';
  }

  onTypeChange(type: ObservationType) {
    this.error.set(null);
    // The shared location/side fields stay editable under lesion_size, where edits bypass the
    // photo handlers that would clear a stale reference — so drop it on the way out.
    if (type !== 'photo') this.selectedReference.set(null);
    this.typeChange.emit(type);
  }

  referenceLabel(group: PhotoReferenceGroup): string {
    return group.side === 'n/a' ? group.bodyLocation : `${group.bodyLocation} · ${group.side}`;
  }

  isSelectedReference(group: PhotoReferenceGroup): boolean {
    const ref = this.selectedReference();
    return !!ref && this.sameSite(group, ref);
  }

  toggleReference(group: PhotoReferenceGroup) {
    if (this.isSelectedReference(group)) {
      this.selectedReference.set(null);
      return;
    }
    // Prefill location and side only — never sizeCm or note, which are the things being
    // re-measured (frontend.md → Photos, F-8.2 v2).
    this.selectedReference.set(group);
    this.bodyLocation = group.bodyLocation;
    this.side = group.side;
  }

  onPhotoLocationInput(value: string) {
    this.bodyLocation = value;
    this.clearReferenceIfEdited();
  }

  onPhotoSideInput(value: Side) {
    this.side = value;
    this.clearReferenceIfEdited();
  }

  // An edited site means the reference is no longer known to be the right analogue — a photo of a
  // different site must not influence the framing of what may be an unrelated finding, so the
  // selection clears rather than staying pinned.
  private clearReferenceIfEdited() {
    const ref = this.selectedReference();
    if (!ref) return;
    if (this.bodyLocation !== ref.bodyLocation || this.side !== ref.side) {
      this.selectedReference.set(null);
    }
  }

  private sameSite(a: PhotoReferenceGroup, b: PhotoReferenceGroup): boolean {
    return photoSiteKey(a.bodyLocation, a.side) === photoSiteKey(b.bodyLocation, b.side);
  }

  onPhotoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.patientId) {
      this.error.set('Select a patient before adding a photo.');
      input.value = '';
      return;
    }
    this.photoUploading.set(true);
    this.photoUploadError.set(null);
    this.photoUploadedFileId.set(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patientId', this.patientId);
    this.api.post<UploadFileResponse>('/files', formData).subscribe({
      next: (res) => {
        this.photoUploading.set(false);
        this.photoUploadedFileId.set(res.fileId);
      },
      error: (err) => {
        this.photoUploading.set(false);
        this.photoUploadError.set(errorText(err, 'Could not upload photo.'));
      },
    });
  }

  setDocumentMode(mode: 'upload' | 'existing') {
    this.documentMode.set(mode);
    this.documentError.set(null);
    if (mode === 'existing' && !this.patientFilesLoaded() && this.patientId) {
      this.api.get<PatientFileSummary[]>(`/patients/${this.patientId}/files`).subscribe({
        next: (files) => {
          this.patientFiles.set(files);
          this.patientFilesLoaded.set(true);
        },
        error: (err) => this.documentError.set(errorText(err, 'Could not load this patient’s files.')),
      });
    }
  }

  onDocumentFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.patientId) {
      this.error.set('Select a patient before attaching a document.');
      input.value = '';
      return;
    }
    // Eager upload, same as photos: the observation POST only ever carries a fileId.
    this.documentUploading.set(true);
    this.documentError.set(null);
    this.documentUploadedFileId.set(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patientId', this.patientId);
    if (!this.documentLabel.trim()) this.documentLabel = file.name;
    this.api.post<UploadFileResponse>('/files', formData).subscribe({
      next: (res) => {
        this.documentUploading.set(false);
        this.documentUploadedFileId.set(res.fileId);
        this.patientFilesLoaded.set(false); // picker list is stale now
      },
      error: (err) => {
        this.documentUploading.set(false);
        this.documentError.set(errorText(err, 'Could not upload the document.'));
      },
    });
  }

  add() {
    this.error.set(null);
    const metadata = this.buildMetadata();
    if (!metadata) return;
    this.entryAdded.emit({ type: this.entryType, metadata });
    this.reset();
  }

  private buildMetadata(): any | null {
    const note = this.entryNote.trim() || undefined;

    const cfg = this.numberConfig();
    if (cfg) {
      const raw = this.numberValue;
      if (raw === null || isNaN(Number(raw))) {
        this.error.set(`${cfg.label} is required.`);
        return null;
      }
      let value = Number(raw);
      if (cfg.unitKind === 'weight') value = toKg(value, this.weightUnit());
      else if (cfg.unitKind === 'length') value = toCm(value, this.lengthUnit());
      else if (cfg.integer) value = Math.round(value);
      if (cfg.min !== undefined && value < cfg.min) {
        this.error.set(`${cfg.label} must be at least ${cfg.min}.`);
        return null;
      }
      if (cfg.max !== undefined && value > cfg.max) {
        this.error.set(`${cfg.label} must be at most ${cfg.max}.`);
        return null;
      }
      return { [cfg.metadataKey]: value, note };
    }

    switch (this.entryType) {
      case 'temperature': {
        if (this.tempValue === null || isNaN(Number(this.tempValue))) {
          this.error.set('Temperature is required.');
          return null;
        }
        return { value: Number(this.tempValue), unit: this.tempUnit, method: this.tempMethod, note };
      }
      case 'pain_score': {
        if (this.painScore === null) {
          this.error.set('Choose a pain score.');
          return null;
        }
        return { score: this.painScore, note };
      }
      case 'lesion_size': {
        if (this.lesionLength === null || isNaN(Number(this.lesionLength))) {
          this.error.set('Length is required.');
          return null;
        }
        if (!this.bodyLocation.trim()) {
          this.error.set('Body location is required.');
          return null;
        }
        const unit = this.lengthUnit();
        return {
          lengthCm: toCm(Number(this.lesionLength), unit),
          widthCm: this.lesionWidth === null ? null : toCm(Number(this.lesionWidth), unit),
          depthCm: this.lesionDepth === null ? null : toCm(Number(this.lesionDepth), unit),
          bodyLocation: this.bodyLocation.trim(),
          side: this.side,
          note,
        };
      }
      case 'symptom': {
        if (!this.symptomTag.trim()) {
          this.error.set('Symptom is required.');
          return null;
        }
        return { tag: this.symptomTag.trim(), severity: this.symptomSeverity ?? undefined, note };
      }
      case 'tag': {
        if (!this.tagValue.trim()) {
          this.error.set('Tag is required.');
          return null;
        }
        return { tag: this.tagValue.trim(), note };
      }
      case 'note': {
        if (!this.noteText.trim()) {
          this.error.set('Note text is required.');
          return null;
        }
        return { text: this.noteText.trim(), symptom: this.noteSymptom.trim() || undefined };
      }
      case 'photo': {
        const fileId = this.photoUploadedFileId();
        if (!fileId) {
          this.error.set('Upload a photo before adding the entry.');
          return null;
        }
        if (!this.bodyLocation.trim()) {
          this.error.set('Body location is required.');
          return null;
        }
        return {
          fileId,
          bodyLocation: this.bodyLocation.trim(),
          side: this.side,
          sizeCm: this.photoSize === null ? null : toCm(Number(this.photoSize), this.lengthUnit()),
          note,
        };
      }
      case 'document': {
        const fileId = this.documentMode() === 'upload' ? this.documentUploadedFileId() : this.documentExistingFileId;
        if (!fileId) {
          this.error.set(
            this.documentMode() === 'upload'
              ? 'Upload a document before adding the entry.'
              : 'Choose a file before adding the entry.',
          );
          return null;
        }
        return { fileId, label: this.documentLabel.trim() || undefined, note };
      }
      default:
        this.error.set('Unsupported entry type.');
        return null;
    }
  }

  private reset() {
    this.numberValue = null;
    this.entryNote = '';
    this.tempValue = null;
    this.tempMethod = 'unknown';
    this.painScore = null;
    this.lesionLength = null;
    this.lesionWidth = null;
    this.lesionDepth = null;
    this.bodyLocation = '';
    this.side = 'n/a';
    this.selectedReference.set(null);
    this.symptomTag = '';
    this.symptomSeverity = null;
    this.tagValue = '';
    this.noteText = '';
    this.noteSymptom = '';
    this.photoSize = null;
    this.photoUploadedFileId.set(null);
    this.photoUploadError.set(null);
    this.documentUploadedFileId.set(null);
    this.documentError.set(null);
    this.documentExistingFileId = null;
    this.documentLabel = '';
  }
}
