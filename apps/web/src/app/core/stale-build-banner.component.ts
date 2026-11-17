import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { StaleBuildRecovery } from './stale-build';

/**
 * Shown when a page could not be loaded even after the automatic reload (`stale-build.ts`). The
 * click that triggered it must visibly lead somewhere, so this is the "somewhere": what happened
 * and one button that fixes the common case.
 */
@Component({
  selector: 'app-stale-build-banner',
  standalone: true,
  template: `
    @if (recovery.failedUrl()) {
      <div class="stale-build" role="alert" data-testid="stale-build-banner">
        <span>
          This page couldn't load. Salud may have just been updated — reload to get the latest
          version.
        </span>
        <button
          type="button"
          class="primary"
          data-testid="stale-build-reload"
          (click)="recovery.reloadNow()"
        >
          Reload
        </button>
      </div>
    }
  `,
  styles: [
    `
      .stale-build {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin: 0.75rem var(--shell-gutter);
        padding: 0.75rem 1rem;
        border: 1px solid var(--danger-border);
        border-radius: var(--radius-card);
        background: var(--danger-bg);
        color: var(--danger-text);
      }
      .stale-build span {
        flex: 1 1 16rem;
      }
    `,
  ],
})
export class StaleBuildBannerComponent {
  protected readonly recovery = inject(StaleBuildRecovery);
}

/**
 * Rendered in a `@defer` block's `@error` slot. Without an `@error` block a failed deferred chunk
 * logs one opaque NG0750 and leaves the block FAILED for good, so every later click on whatever
 * triggers it does nothing and logs nothing. This hands the failure to the same one-shot reload
 * as a failed lazy route, at the page the caregiver is on.
 */
@Component({
  selector: 'app-deferred-chunk-failed',
  standalone: true,
  template: '',
})
export class DeferredChunkFailedComponent {
  constructor() {
    const recovery = inject(StaleBuildRecovery);
    const location = inject(Location);
    recovery.recoverFromChunkFailure(location.path());
  }
}
