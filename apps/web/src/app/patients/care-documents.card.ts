import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CareDocumentKind,
  CareDocumentStatement,
  CareDocumentsMap,
  PatientFileSummary,
  SetCareDocumentDto,
  UploadFileResponse,
} from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { timeAgo } from '../core/relative-time';
import { DocumentLinkComponent } from '../timeline/document-link.component';

interface KindRow {
  kind: CareDocumentKind;
  key: keyof CareDocumentsMap;
  label: string;
}

/**
 * Living will / advance directive / medical PoA (frontend.md → Patient detail, §4.1).
 *
 * Three fixed rows, always rendered, each showing one arm of the tri-state: "not recorded",
 * an affirmative "none" with its attribution, or the document on file. A row is never hidden for
 * lack of data — at triage, "not recorded" is itself actionable ("ask the family"), and a missing
 * row would read as "none" to whoever is looking.
 */
@Component({
  selector: 'app-care-documents-card',
  standalone: true,
  imports: [CommonModule, FormsModule, DocumentLinkComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Care documents</h2>
          <p class="muted">Living will, advance directive, medical power of attorney.</p>
        </div>
      </div>

      <div class="error" *ngIf="loadError()">{{ loadError() }}</div>
      <p class="muted" *ngIf="loading()">Loading…</p>

      <div class="row-list" *ngIf="!loading() && !loadError()">
        <div class="doc-row" *ngFor="let row of rows">
          <div class="doc-main">
            <span class="doc-label">{{ row.label }}</span>

            <ng-container [ngSwitch]="statusOf(row.key)">
              <!-- Nobody has told the app anything. Said out loud, never left blank. -->
              <span *ngSwitchCase="'not_recorded'" class="pill pill-neutral">Not recorded</span>

              <span *ngSwitchCase="'none'" class="pill pill-neutral">None</span>

              <app-document-link
                *ngSwitchCase="'on_file'"
                [fileId]="statementOf(row.key)!.fileId!"
                [label]="statementOf(row.key)!.originalName || 'Document'"
              ></app-document-link>
            </ng-container>
          </div>

          <p class="muted small" *ngIf="statementOf(row.key) as statement">
            {{ statement.status === 'none' ? 'Stated by' : 'Uploaded by' }} {{ statement.setByName }} ·
            {{ ageOf(statement) }}
          </p>
          <p class="muted small" *ngIf="holderLine(row.key) as holder">{{ holder }}</p>

          <div class="doc-actions" *ngIf="editing() !== row.kind">
            <label class="upload">
              <input
                type="file"
                accept="application/pdf,image/*"
                (change)="uploadFor(row.kind, $event)"
                [disabled]="busy() !== null"
              />
              <span class="secondary">{{ statementOf(row.key)?.status === 'on_file' ? 'Replace' : 'Upload' }}</span>
            </label>
            <button
              class="secondary"
              type="button"
              *ngIf="existingFiles().length"
              (click)="startAttach(row.kind)"
              [disabled]="busy() !== null"
            >
              Attach existing
            </button>
            <button class="secondary" type="button" (click)="recordNone(row.kind)" [disabled]="busy() !== null">
              Record as none
            </button>
          </div>

          <!-- Attach-existing picker: the file arrived via an earlier upload or a lab import. -->
          <div class="inline" *ngIf="editing() === row.kind">
            <select [(ngModel)]="attachFileId" [name]="'attach-' + row.kind">
              <option value="">Choose a file…</option>
              <option *ngFor="let f of existingFiles()" [value]="f.id">{{ f.originalName || f.id }}</option>
            </select>
            <button class="primary" type="button" [disabled]="!attachFileId || busy() !== null" (click)="attach(row.kind)">
              Attach
            </button>
            <button class="secondary" type="button" (click)="editing.set(null)">Cancel</button>
          </div>

          <p class="muted small" *ngIf="busy() === row.kind">Saving…</p>
          <p class="error small" *ngIf="rowError() && busy() === null && erroredKind() === row.kind">
            {{ rowError() }}
          </p>

          <!-- PoA is a person as well as a document; the holder is what triage actually calls. -->
          <div class="holder-fields" *ngIf="row.kind === 'medical_poa'">
            <input type="text" [(ngModel)]="holderName" name="holderName" placeholder="Holder name (optional)" />
            <input type="text" [(ngModel)]="holderPhone" name="holderPhone" placeholder="Holder phone (optional)" />
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .doc-row {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 0.65rem 0;
      }
      .doc-main {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .doc-label {
        font-weight: 700;
      }
      .doc-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      /* A file input styled as a button: the native control's text is unstyleable and reads
         "No file chosen", which is not what this row is offering. */
      .upload input {
        display: none;
      }
      .upload .secondary {
        display: inline-block;
        cursor: pointer;
      }
      .inline {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .holder-fields {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .holder-fields input {
        max-width: 15rem;
      }
    `,
  ],
})
export class CareDocumentsCardComponent implements OnInit {
  private readonly api = inject(ApiClientService);

  @Input({ required: true }) patientId!: string;

  protected readonly rows: KindRow[] = [
    { kind: 'living_will', key: 'livingWill', label: 'Living will' },
    { kind: 'advance_directive', key: 'advanceDirective', label: 'Advance directive' },
    { kind: 'medical_poa', key: 'medicalPoa', label: 'Medical POA' },
  ];

  documents = signal<CareDocumentsMap | null>(null);
  existingFiles = signal<PatientFileSummary[]>([]);
  loading = signal(true);
  loadError = signal<string | null>(null);
  rowError = signal<string | null>(null);
  erroredKind = signal<CareDocumentKind | null>(null);
  busy = signal<CareDocumentKind | null>(null);
  editing = signal<CareDocumentKind | null>(null);
  attachFileId = '';
  holderName = '';
  holderPhone = '';

  ngOnInit(): void {
    this.load();
    this.api.get<PatientFileSummary[]>(`/patients/${this.patientId}/files`).subscribe({
      next: (files) => this.existingFiles.set(files),
      // A failed picker list is not worth an error banner — the upload path still works.
      error: () => this.existingFiles.set([]),
    });
  }

  private load() {
    this.loading.set(true);
    this.api.get<CareDocumentsMap>(`/patients/${this.patientId}/care-documents`).subscribe({
      next: (map) => {
        this.documents.set(map);
        this.holderName = map.medicalPoa?.holderName ?? '';
        this.holderPhone = map.medicalPoa?.holderPhone ?? '';
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.loadError.set(errorText(err, 'Could not load care documents.'));
      },
    });
  }

  statementOf(key: keyof CareDocumentsMap): CareDocumentStatement | null {
    return this.documents()?.[key] ?? null;
  }

  /** The tri-state, resolved for the template: no row at all is "not_recorded". */
  statusOf(key: keyof CareDocumentsMap): 'not_recorded' | 'none' | 'on_file' {
    const statement = this.statementOf(key);
    if (!statement) return 'not_recorded';
    return statement.status;
  }

  ageOf(statement: CareDocumentStatement): string {
    return timeAgo(statement.setAt);
  }

  holderLine(key: keyof CareDocumentsMap): string | null {
    const statement = this.statementOf(key);
    if (!statement?.holderName && !statement?.holderPhone) return null;
    return [statement.holderName, statement.holderPhone].filter(Boolean).join(' · ');
  }

  startAttach(kind: CareDocumentKind) {
    this.attachFileId = '';
    this.editing.set(kind);
  }

  uploadFor(kind: CareDocumentKind, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(kind);
    this.rowError.set(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patientId', this.patientId);
    this.api.post<UploadFileResponse>('/files', formData).subscribe({
      next: (res) => {
        input.value = '';
        this.save(kind, { status: 'on_file', fileId: res.fileId });
      },
      error: (err) => {
        input.value = '';
        this.fail(kind, err, 'Could not upload that document.');
      },
    });
  }

  attach(kind: CareDocumentKind) {
    if (!this.attachFileId) return;
    this.editing.set(null);
    this.save(kind, { status: 'on_file', fileId: this.attachFileId });
  }

  /**
   * Recording "none" is a deliberate act behind a confirm, never a default and never a checkbox
   * (frontend.md). The ER Brief presents it to triage as a family statement, so it must be
   * impossible to record by accident — the whole value of the tri-state collapses otherwise.
   */
  recordNone(kind: CareDocumentKind) {
    const label = this.rows.find((r) => r.kind === kind)?.label ?? 'this document';
    if (!window.confirm(`Record that no ${label.toLowerCase()} exists? This is shown to clinicians as a statement from your family.`)) {
      return;
    }
    this.save(kind, { status: 'none' });
  }

  private save(kind: CareDocumentKind, body: SetCareDocumentDto) {
    this.busy.set(kind);
    this.rowError.set(null);
    const dto: SetCareDocumentDto =
      kind === 'medical_poa'
        ? {
            ...body,
            ...(this.holderName.trim() ? { holderName: this.holderName.trim() } : {}),
            ...(this.holderPhone.trim() ? { holderPhone: this.holderPhone.trim() } : {}),
          }
        : body;
    this.api
      .put<CareDocumentsMap, SetCareDocumentDto>(`/patients/${this.patientId}/care-documents/${kind}`, dto)
      .subscribe({
        next: (map) => {
          this.documents.set(map);
          this.busy.set(null);
        },
        error: (err) => this.fail(kind, err, 'Could not save that care document.'),
      });
  }

  private fail(kind: CareDocumentKind, err: unknown, fallback: string) {
    this.busy.set(null);
    this.erroredKind.set(kind);
    this.rowError.set(errorText(err, fallback));
  }
}
