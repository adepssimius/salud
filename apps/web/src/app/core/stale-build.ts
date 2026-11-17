import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  inject,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Recovery from a deploy that replaced the lazy chunks an open tab still references.
 *
 * Every route is lazy (`app.routes.ts`), and each build names its chunks by content hash. A tab
 * opened before a deploy keeps the old `main-*.js` in memory, so its next navigation to a page it
 * has not loaded yet asks for a `chunk-*.js` the new image no longer has. The import rejects, the
 * router emits `NavigationError`, and — left alone — the click does nothing at all. A caregiver at
 * 3 AM has no reason to know that "hard reload" is the fix.
 *
 * So: the first time a chunk fails to load, reload the page at the URL the caregiver was going to,
 * which fetches the current `index.html` and lands them on the new build where they meant to be.
 * A per-tab marker in `sessionStorage` makes that a one-shot: if the reload fails the same way, the
 * build itself is not loading (a broken deploy, a network fault), and another reload would only
 * loop. Then the banner says so and offers a Reload button instead.
 */

/** sessionStorage key for the one-shot marker. Per tab, which is exactly the scope of the problem. */
export const STALE_BUILD_RETRY_KEY = 'salud.staleBuildRetry';

/**
 * How long an automatic reload counts as "just tried". The marker is also cleared on the first
 * successful navigation, so this only bounds a marker that nothing cleared: a tab whose retry
 * failed and then sat there still recovers by itself from the *next* deploy.
 */
export const STALE_BUILD_RETRY_WINDOW_MS = 60_000;

/**
 * Browser wording for a dynamic `import()` whose module could not be fetched or was not
 * JavaScript. It is a `TypeError` in all three engines, so the message is the only discriminator:
 *  - Chromium: "Failed to fetch dynamically imported module: <url>"
 *  - Firefox:  "error loading dynamically imported module: <url>"
 *  - Safari:   "Importing a module script failed."
 * The last two cover a bundler's own chunk loader, should the builder ever change.
 */
const CHUNK_LOAD_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'ChunkLoadError') return true;
  const message =
    typeof error === 'string' ? error : (error as { message?: unknown }).message;
  return typeof message === 'string' && CHUNK_LOAD_ERROR.test(message);
}

/** A full-page load of `url`. A token so specs can watch it without jsdom navigating. */
export const HARD_NAVIGATE = new InjectionToken<(url: string) => void>(
  'HARD_NAVIGATE',
  { providedIn: 'root', factory: () => (url: string) => window.location.assign(url) }
);

interface RetryMarker {
  url: string;
  at: number;
}

@Injectable({ providedIn: 'root' })
export class StaleBuildRecovery {
  private readonly location = inject(Location);
  private readonly hardNavigate = inject(HARD_NAVIGATE);

  /**
   * The app URL whose page could not be loaded even after the automatic reload, or `null`. Set,
   * the shell shows the stale-build banner.
   */
  readonly failedUrl = signal<string | null>(null);

  /**
   * The router's navigation error handler (`withNavigationErrorHandler` in `app.config.ts`).
   * Returns nothing either way, so the router still emits the error and rejects the navigation —
   * this only adds the recovery, it never hides a failure.
   */
  handleNavigationError(event: NavigationError): void {
    if (!isChunkLoadError(event.error)) return;
    this.recoverFromChunkFailure(event.url);
  }

  /**
   * A lazily loaded chunk for `url` (an app URL, as the router serializes it) failed to load:
   * reload there once, or — if that was already tried — show the banner. Also the `@error` path of
   * the shell's `@defer` block, which never sees the underlying error but in a deployed app has
   * no other way to fail.
   */
  recoverFromChunkFailure(url: string): void {
    const marker = this.readMarker();
    // `undefined` = sessionStorage is unusable (blocked, private mode). With no way to remember
    // that a reload already happened, reloading could loop forever; show the banner instead.
    if (marker === undefined || (marker && Date.now() - marker.at < STALE_BUILD_RETRY_WINDOW_MS)) {
      this.failedUrl.set(url);
      return;
    }
    if (!this.writeMarker({ url, at: Date.now() })) {
      this.failedUrl.set(url);
      return;
    }
    this.hardNavigate(this.location.prepareExternalUrl(url));
  }

  /** A navigation got all the way through: the build is loading, so the next failure may retry. */
  clearRetryMarker(): void {
    try {
      sessionStorage.removeItem(STALE_BUILD_RETRY_KEY);
    } catch {
      // Unusable storage has no marker to clear.
    }
  }

  /** The banner's Reload button. The caregiver asked for it, so it is not a loop to guard. */
  reloadNow(): void {
    const url = this.failedUrl() ?? this.location.path();
    this.clearRetryMarker();
    this.hardNavigate(this.location.prepareExternalUrl(url));
  }

  /** `null` = no marker; `undefined` = storage is unusable. */
  private readMarker(): RetryMarker | null | undefined {
    try {
      const raw = sessionStorage.getItem(STALE_BUILD_RETRY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RetryMarker>;
      return typeof parsed?.at === 'number'
        ? { url: String(parsed.url ?? ''), at: parsed.at }
        : null;
    } catch {
      return undefined;
    }
  }

  private writeMarker(marker: RetryMarker): boolean {
    try {
      sessionStorage.setItem(STALE_BUILD_RETRY_KEY, JSON.stringify(marker));
      return true;
    } catch {
      return false;
    }
  }
}

/** For `withNavigationErrorHandler(...)`; runs in the router's injection context. */
export function staleBuildNavigationErrorHandler(event: NavigationError): void {
  inject(StaleBuildRecovery).handleNavigationError(event);
}

/** Clears the one-shot marker on every completed navigation, starting with the initial one. */
export function provideStaleBuildRecovery(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const recovery = inject(StaleBuildRecovery);
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        recovery.clearRetryMarker();
        recovery.failedUrl.set(null);
      });
  });
}
