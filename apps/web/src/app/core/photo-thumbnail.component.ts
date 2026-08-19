import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClientService } from './api-client.service';

// Photo entries store a fileId, not a URL — <img src> can't carry an Authorization header, so
// this fetches the blob through the authenticated client and renders it via an object URL (F-8.2).
@Component({
  selector: 'app-photo-thumbnail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <a
      *ngIf="objectUrl() && link"
      [href]="objectUrl()"
      target="_blank"
      rel="noopener"
      class="photo-thumb"
      [class.large]="large"
    >
      <img [src]="objectUrl()" alt="photo entry" />
    </a>
    <span *ngIf="objectUrl() && !link" class="photo-thumb" [class.large]="large">
      <img [src]="objectUrl()" alt="photo entry" />
    </span>
  `,
  styles: [
    `
      .photo-thumb {
        display: inline-block;
        line-height: 0;
      }
      img {
        width: 84px;
        height: 84px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .large img {
        width: 136px;
        height: 136px;
      }
    `,
  ],
})
export class PhotoThumbnailComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiClientService);

  @Input({ required: true }) fileId!: string;
  /** false renders a plain image with no anchor — for use inside a card that is itself a button. */
  @Input() link = true;
  @Input() large = false;

  objectUrl = signal<string | null>(null);

  ngOnChanges(): void {
    if (!this.fileId) {
      this.revoke();
      return;
    }
    this.api.getBlob(`/files/${this.fileId}`).subscribe({
      next: (blob) => {
        this.revoke();
        this.objectUrl.set(URL.createObjectURL(blob));
      },
      error: () => {
        this.revoke();
      },
    });
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  private revoke(): void {
    const current = this.objectUrl();
    if (current) URL.revokeObjectURL(current);
    this.objectUrl.set(null);
  }
}
