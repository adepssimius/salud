import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CareDocumentStatement, CareDocumentsMap } from '@salud/shared/types';
import { DocumentLinkComponent } from '../timeline/document-link.component';

interface DocRow {
  key: keyof CareDocumentsMap;
  label: string;
}

/**
 * The three care-document lines in the ER Brief header (er-brief.md → Header/Web).
 *
 * Always three lines, on screen, in flash mode and in print: whether a directive exists is an
 * arm's-length triage fact, and "not recorded" is actionable in its own right ("ask the family").
 * A conditionally-absent section would read as "none" to whoever is looking, which is the one
 * thing the tri-state exists to prevent.
 *
 * Shared by the live page and the public `/brief/:token` page so the two cannot drift. The only
 * difference between them is `frozenAt`: when set, each line carries the may-have-been-superseded
 * caveat and files are fetched through the snapshot's token-scoped route, since a clinician
 * reading a shared link has no account to authenticate with.
 */
@Component({
  selector: 'app-brief-care-documents',
  standalone: true,
  imports: [CommonModule, DocumentLinkComponent],
  template: `
    <div class="field-row care-documents">
      <span class="label">Care documents</span>
      <div class="doc-lines">
        <div class="doc-line" *ngFor="let row of rows">
          <span class="doc-label">{{ row.label }}:</span>

          <ng-container *ngIf="statementOf(row.key) as statement; else notRecorded">
            <ng-container *ngIf="statement.status === 'none'">
              <span>none</span>
              <span class="muted small">
                — stated by {{ statement.setByName }}, {{ statement.setAt * 1000 | date: 'mediumDate' }}
              </span>
            </ng-container>

            <ng-container *ngIf="statement.status === 'on_file'">
              <app-document-link
                [fileId]="statement.fileId!"
                [label]="statement.originalName || 'Document'"
                [apiPath]="filePathFor(statement)"
              ></app-document-link>
              <span class="muted small">
                — uploaded by {{ statement.setByName }}, {{ statement.setAt * 1000 | date: 'mediumDate' }}
              </span>
            </ng-container>

            <span class="muted small" *ngIf="holderLine(statement) as holder"> · {{ holder }}</span>
          </ng-container>

          <!-- Said out loud, never a blank: at triage this is the cue to ask the family. -->
          <ng-template #notRecorded>
            <span class="missing">not recorded</span>
          </ng-template>

          <!-- Unconditional, and built from the snapshot's own frozen date. Deliberately not a
               live check: a conditional warning's silence would read as "still current", which is
               a currency the app cannot promise (er-brief.md → Formats). -->
          <span class="muted small caveat" *ngIf="frozenAt">
            — as on file {{ frozenAt! * 1000 | date: 'mediumDate' }}; may have been superseded, ask
            the family for a current link
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .doc-lines {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .doc-line {
        display: flex;
        align-items: baseline;
        gap: 0.3rem;
        flex-wrap: wrap;
      }
      .doc-label {
        font-weight: 700;
      }
      .caveat {
        font-style: italic;
      }
    `,
  ],
})
export class BriefCareDocumentsComponent {
  @Input({ required: true }) documents!: CareDocumentsMap | null | undefined;
  /** Set on a frozen snapshot only — drives both the caveat and the token-scoped file route. */
  @Input() frozenAt: number | null = null;
  @Input() shareToken: string | null = null;

  protected readonly rows: DocRow[] = [
    { key: 'livingWill', label: 'Living will' },
    { key: 'advanceDirective', label: 'Advance directive' },
    { key: 'medicalPoa', label: 'Medical POA' },
  ];

  /**
   * Snapshots frozen before care documents existed carry no `careDocuments` at all. Treating a
   * missing map as three unrecorded kinds keeps those links readable and still truthful — the app
   * genuinely was never told.
   */
  statementOf(key: keyof CareDocumentsMap): CareDocumentStatement | null {
    return this.documents?.[key] ?? null;
  }

  filePathFor(statement: CareDocumentStatement): string | null {
    if (!this.shareToken) return null;
    return `/er-brief/shared/${this.shareToken}/files/${statement.fileId}`;
  }

  holderLine(statement: CareDocumentStatement): string | null {
    if (!statement.holderName && !statement.holderPhone) return null;
    return [statement.holderName, statement.holderPhone].filter(Boolean).join(' · ');
  }
}
