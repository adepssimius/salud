import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withRouterConfig } from '@angular/router';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authInterceptor])),
    // `paramsInheritanceStrategy: 'always'` makes the patient hub's children see the parent's
    // `:id`. Without it every page nested under `patients/:id` reads an empty param and silently
    // requests `/patients//...` — the tabs, and the timeline page that moved under the hub, all
    // read the id the same way they always did.
    provideRouter(appRoutes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
  ],
};
