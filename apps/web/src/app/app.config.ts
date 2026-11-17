import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  TitleStrategy,
  provideRouter,
  withNavigationErrorHandler,
  withRouterConfig,
} from '@angular/router';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { SaludTitleStrategy } from './core/page-title.strategy';
import {
  provideStaleBuildRecovery,
  staleBuildNavigationErrorHandler,
} from './core/stale-build';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authInterceptor])),
    // `paramsInheritanceStrategy: 'always'` makes the patient hub's children see the parent's
    // `:id`. Without it every page nested under `patients/:id` reads an empty param and silently
    // requests `/patients//...` — the tabs, and the timeline page that moved under the hub, all
    // read the id the same way they always did.
    //
    // The navigation error handler recovers a tab that outlived a deploy: its lazy route chunks
    // are gone from the new image, so the first failed chunk load reloads the page once at the
    // URL being navigated to (core/stale-build.ts). provideStaleBuildRecovery clears that
    // one-shot marker once a navigation completes.
    provideRouter(
      appRoutes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withNavigationErrorHandler(staleBuildNavigationErrorHandler)
    ),
    provideStaleBuildRecovery(),
    // Route `title`s composed with the patient's name (core/page-title.strategy.ts). The same
    // `paramsInheritanceStrategy: 'always'` above is what lets the hub's children inherit the
    // parent's `patientTitle` data flag and `:id`, so each tab titles itself without repeating them.
    { provide: TitleStrategy, useExisting: SaludTitleStrategy },
  ],
};
