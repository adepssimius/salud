import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClientService } from '../core/api-client.service';

/**
 * A `document` entry as a labeled attachment link (frontend.md → Documents: "a labeled attachment
 * link, not a text summary line").
 *
 * Fetched lazily, unlike the photo thumbnail beside it: a thumbnail has to load to be a thumbnail,
 * but an after-visit summary PDF is a link until someone wants it. A day with four attached
 * documents would otherwise pull four blobs nobody opened, which on a phone at 3 AM is the whole
 * budget. `<a href>` can't carry an Authorization header (same constraint as the thumbnail), so the
 * click fetches through the authenticated client and opens the resulting object URL.
 *
 * Lives beside the journal rather than in `core/` because the feed is its only consumer today;
 * move it up when a second one appears.
 */
@Component({
  selector: 'app-document-link',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button type="button" class="doc-link" (click)="open()" [disabled]="loading()">
      <span aria-hidden="true">📎</span>
      <span>{{ label }}</span>
      <span class="muted small" *ngIf="loading()">opening…</span>
    </button>
    <span class="error small" *ngIf="failed()">Couldn't open that attachment.</span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .doc-link {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.2rem 0.55rem;
        border-radius: var(--radius-pill);
        border: 1px solid var(--border-strong);
        background: var(--surface-raised);
        color: var(--accent-soft);
        font: inherit;
        font-size: 0.8rem;
        cursor: pointer;
      }
      .doc-link:disabled {
        cursor: progress;
        opacity: 0.7;
      }
    `,
  ],
})
export class DocumentLinkComponent implements OnDestroy {
  private readonly api = inject(ApiClientService);

  @Input({ required: true }) fileId!: string;
  @Input({ required: true }) label!: string;

  loading = signal(false);
  failed = signal(false);
  private objectUrl: string | null = null;

  open(): void {
    if (this.loading()) return;
    this.failed.set(false);
    if (this.objectUrl) {
      window.open(this.objectUrl, '_blank', 'noopener');
      return;
    }
    this.loading.set(true);
    this.api.getBlob(`/files/${this.fileId}`).subscribe({
      next: (blob) => {
        this.loading.set(false);
        this.objectUrl = URL.createObjectURL(blob);
        window.open(this.objectUrl, '_blank', 'noopener');
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
