import { Route } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { PatientHubStore } from './patients/patient-hub.store';

// Every page is loaded lazily, including login. Importing them statically put all 21 pages — and
// @angular/forms, which only pages use — into the initial bundle, which is what pushed it 72 kB past
// the 500 kB budget. Keeping login eager to save one round-trip would drag forms back in on its own.
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage) },
  { path: 'register', loadComponent: () => import('./auth/register.page').then((m) => m.RegisterPage) },
  { path: 'logout', loadComponent: () => import('./auth/logout.page').then((m) => m.LogoutPage) },
  // Unauthenticated by design, same bucket as login/register/brief/:token — this is where
  // GET /auth/oidc/callback redirects the browser with its one-time handoff code (security.md →
  // "OIDC login"). It can't be behind authGuard: there is no session yet when it's reached.
  {
    path: 'oidc-complete',
    loadComponent: () => import('./auth/oidc-complete.page').then((m) => m.OidcCompletePage),
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then((m) => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    path: 'patients',
    loadComponent: () => import('./patients/patients-list.page').then((m) => m.PatientsListPage),
    canActivate: [authGuard],
  },
  // Before `patients/:id`: routes match top-down, so the literal has to win over the parameter.
  {
    path: 'patients/new',
    loadComponent: () => import('./patients/new-patient.page').then((m) => m.NewPatientPage),
    canActivate: [authGuard],
  },
  { path: 'patients/:id/timeline', redirectTo: 'patients/:id/journal' },
  {
    path: 'patients/:id/conditions/new',
    loadComponent: () => import('./conditions/new-condition.page').then((m) => m.NewConditionPage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/reactions/new',
    loadComponent: () => import('./reactions/new-reaction.page').then((m) => m.NewReactionPage),
    canActivate: [authGuard],
  },
  {
    path: 'conditions/:id',
    loadComponent: () => import('./conditions/condition-detail.page').then((m) => m.ConditionDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'episodes/:id',
    loadComponent: () => import('./episodes/episode-detail.page').then((m) => m.EpisodeDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/er-brief',
    loadComponent: () => import('./er-brief/er-brief.page').then((m) => m.ErBriefPage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/lab-import',
    loadComponent: () => import('./labs/lab-import.page').then((m) => m.LabImportPage),
    canActivate: [authGuard],
  },
  {
    path: 'analytes',
    loadComponent: () => import('./analytes/analytes.page').then((m) => m.AnalytesPage),
    canActivate: [authGuard],
  },
  {
    path: 'analytes/:id',
    loadComponent: () => import('./analytes/analyte-detail.page').then((m) => m.AnalyteDetailPage),
    canActivate: [authGuard],
  },
  // No authGuard — a clinician opening a shared brief now downloads the framework plus this one
  // chunk instead of every page in the app.
  { path: 'brief/:token', loadComponent: () => import('./er-brief/shared-brief.page').then((m) => m.SharedBriefPage) },
  {
    path: 'patients/:id/whats-new',
    loadComponent: () => import('./whats-new/whats-new.page').then((m) => m.WhatsNewPage),
    canActivate: [authGuard],
  },
  // The patient hub. Declared after every literal `patients/:id/<segment>` route above, because
  // routes match top-down and this one would otherwise swallow them: ER Brief and lab import are
  // full pages (the brief is a print document), not tabs, so they must not render inside the tab
  // chrome. Children read `:id` off this parent via `paramsInheritanceStrategy: 'always'`
  // (app.config.ts), which is what lets the journal page read its patient id without a resolver.
  {
    path: 'patients/:id',
    loadComponent: () => import('./patients/patient-hub.shell').then((m) => m.PatientHubShell),
    canActivate: [authGuard],
    providers: [PatientHubStore],
    children: [
      // `now` is deferred (it needs the bimodal Home work), so a quiet and a sick patient both
      // land on the journal for the moment.
      { path: '', pathMatch: 'full', redirectTo: 'journal' },
      {
        path: 'journal',
        loadComponent: () => import('./timeline/journal.page').then((m) => m.JournalPage),
      },
      {
        path: 'meds',
        loadComponent: () => import('./patients/tabs/patient-meds.page').then((m) => m.PatientMedsPage),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./patients/tabs/patient-history.page').then((m) => m.PatientHistoryPage),
      },
      {
        path: 'share',
        loadComponent: () => import('./patients/tabs/patient-share.page').then((m) => m.PatientSharePage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./patients/tabs/patient-settings.page').then((m) => m.PatientSettingsPage),
      },
    ],
  },
  {
    path: 'observations/new',
    loadComponent: () => import('./observations/new-observation.page').then((m) => m.NewObservationPage),
    canActivate: [authGuard],
  },
  {
    path: 'interventions/new',
    loadComponent: () => import('./interventions/new-intervention.page').then((m) => m.NewInterventionPage),
    canActivate: [authGuard],
  },
  {
    path: 'medications',
    loadComponent: () => import('./medications/medications.page').then((m) => m.MedicationsPage),
    canActivate: [authGuard],
  },
  {
    path: 'medications/:id',
    loadComponent: () => import('./medications/medication-detail.page').then((m) => m.MedicationDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'schedules/new',
    loadComponent: () => import('./schedules/new-schedule.page').then((m) => m.NewSchedulePage),
    canActivate: [authGuard],
  },
  {
    path: 'schedules/:id',
    loadComponent: () => import('./schedules/schedule-detail.page').then((m) => m.ScheduleDetailPage),
    canActivate: [authGuard],
  },
  // Household setup, moved off Home (frontend.md → "Information architecture (v2)" → Home:
  // "Catalog and admin actions leave Home"). Reached from the avatar menu.
  {
    path: 'manage',
    loadComponent: () => import('./manage/manage.page').then((m) => m.ManagePage),
    canActivate: [authGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];
