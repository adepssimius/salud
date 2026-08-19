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
      [class.full]="full"
    >
      <img [src]="objectUrl()" alt="photo entry" />
    </a>
    <span *ngIf="objectUrl() && !link" class="photo-thumb" [class.large]="large" [class.full]="full">
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
      /* The progression view is the one place the photo itself is the content rather than a
         pointer to it, so it is shown whole — contained, not cropped square, because a lesion
         edge cropped out of a comparison shot is exactly the detail being compared. */
      .full {
        display: block;
      }
      .full img {
        width: 100%;
        max-width: 320px;
        height: auto;
        max-height: 360px;
        object-fit: contain;
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
  /** Whole-image rendering for the photo progression view — see the `.full` rule above. */
  @Input() full = false;

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
