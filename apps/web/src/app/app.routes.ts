import { Route } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { PatientHubStore } from './patients/patient-hub.store';

// Every page is loaded lazily, including login. Importing them statically put all 21 pages — and
// @angular/forms, which only pages use — into the initial bundle, which is what pushed it 72 kB past
// the 500 kB budget. Keeping login eager to save one round-trip would drag forms back in on its own.
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage),
    title: 'Sign in',
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./auth/register.page').then((m) => m.RegisterPage),
    title: 'Create account',
  },
  {
    path: 'logout',
    loadComponent: () => import('./auth/logout.page').then((m) => m.LogoutPage),
    title: 'Sign out',
  },
  // Unauthenticated by design, same bucket as login/register/brief/:token — this is where
  // GET /auth/oidc/callback redirects the browser with its one-time handoff code (security.md →
  // "OIDC login"). It can't be behind authGuard: there is no session yet when it's reached.
  {
    path: 'oidc-complete',
    loadComponent: () =>
      import('./auth/oidc-complete.page').then((m) => m.OidcCompletePage),
    title: 'Signing in',
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./profile/profile.page').then((m) => m.ProfilePage),
    title: 'Profile',
    canActivate: [authGuard],
  },
  {
    path: 'patients',
    loadComponent: () =>
      import('./patients/patients-list.page').then((m) => m.PatientsListPage),
    title: 'Patients',
    canActivate: [authGuard],
  },
  // Before `patients/:id`: routes match top-down, so the literal has to win over the parameter.
  {
    path: 'patients/new',
    loadComponent: () =>
      import('./patients/new-patient.page').then((m) => m.NewPatientPage),
    title: 'New patient',
    canActivate: [authGuard],
  },
  { path: 'patients/:id/timeline', redirectTo: 'patients/:id/journal' },
  {
    path: 'patients/:id/conditions/new',
    loadComponent: () =>
      import('./conditions/new-condition.page').then((m) => m.NewConditionPage),
    title: 'New condition',
    data: { patientTitle: true },
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/reactions/new',
    loadComponent: () =>
      import('./reactions/new-reaction.page').then((m) => m.NewReactionPage),
    title: 'New reaction',
    data: { patientTitle: true },
    canActivate: [authGuard],
  },
  {
    path: 'conditions/:id',
    loadComponent: () =>
      import('./conditions/condition-detail.page').then(
        (m) => m.ConditionDetailPage
      ),
    title: 'Condition',
    canActivate: [authGuard],
  },
  {
    path: 'episodes/:id',
    loadComponent: () =>
      import('./episodes/episode-detail.page').then((m) => m.EpisodeDetailPage),
    title: 'Episode',
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/er-brief',
    loadComponent: () =>
      import('./er-brief/er-brief.page').then((m) => m.ErBriefPage),
    title: 'ER Brief',
    data: { patientTitle: true },
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/lab-import',
    loadComponent: () =>
      import('./labs/lab-import.page').then((m) => m.LabImportPage),
    title: 'Lab import',
    data: { patientTitle: true },
    canActivate: [authGuard],
  },
  {
    path: 'analytes',
    loadComponent: () =>
      import('./analytes/analytes.page').then((m) => m.AnalytesPage),
    title: 'Analytes',
    canActivate: [authGuard],
  },
  {
    path: 'analytes/:id',
    loadComponent: () =>
      import('./analytes/analyte-detail.page').then((m) => m.AnalyteDetailPage),
    title: 'Analyte',
    canActivate: [authGuard],
  },
  // No authGuard — a clinician opening a shared brief now downloads the framework plus this one
  // chunk instead of every page in the app.
  {
    path: 'brief/:token',
    loadComponent: () =>
      import('./er-brief/shared-brief.page').then((m) => m.SharedBriefPage),
    title: 'Shared ER Brief',
  },
  // `/patients/:id/whats-new` is gone: the since-you-last-looked marker lives inside the journal
  // feed now (frontend.md → "Information architecture (v2)" → Journal), so the briefing is read in
  // the place the narrative already is. Home's summary rows deep-link to the journal instead.
  { path: 'patients/:id/whats-new', redirectTo: 'patients/:id/journal' },
  // The patient hub. Declared after every literal `patients/:id/<segment>` route above, because
  // routes match top-down and this one would otherwise swallow them: ER Brief and lab import are
  // full pages (the brief is a print document), not tabs, so they must not render inside the tab
  // chrome. Children read `:id` off this parent via `paramsInheritanceStrategy: 'always'`
  // (app.config.ts), which is what lets the journal page read its patient id without a resolver.
  {
    path: 'patients/:id',
    loadComponent: () =>
      import('./patients/patient-hub.shell').then((m) => m.PatientHubShell),
    canActivate: [authGuard],
    providers: [PatientHubStore],
    data: { patientTitle: true },
    children: [
      // `now` is deferred (it needs the bimodal Home work), so a quiet and a sick patient both
      // land on the journal for the moment.
      { path: '', pathMatch: 'full', redirectTo: 'journal' },
      // `share` was this tab's name until it turned out nobody looks for their co-parent under it.
      { path: 'share', redirectTo: 'care-team' },
      {
        path: 'journal',
        loadComponent: () =>
          import('./timeline/journal.page').then((m) => m.JournalPage),
        title: 'Journal',
      },
      // Photos by site — the progression read of `photo` entries (frontend.md → Photos →
      // "Photos by site"). A hub child, so it inherits `:id` and the patient header like the
      // other tabs.
      {
        path: 'photos',
        loadComponent: () =>
          import('./photos/photos.page').then((m) => m.PhotosPage),
        title: 'Photos',
      },
      {
        path: 'meds',
        loadComponent: () =>
          import('./patients/tabs/patient-meds.page').then(
            (m) => m.PatientMedsPage
          ),
        title: 'Meds',
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./patients/tabs/patient-history.page').then(
            (m) => m.PatientHistoryPage
          ),
        title: 'History',
      },
      {
        path: 'care-team',
        loadComponent: () =>
          import('./patients/tabs/patient-care-team.page').then(
            (m) => m.PatientCareTeamPage
          ),
        title: 'Care team',
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./patients/tabs/patient-settings.page').then(
            (m) => m.PatientSettingsPage
          ),
        title: 'Settings',
      },
    ],
  },
  {
    path: 'observations/new',
    loadComponent: () =>
      import('./observations/new-observation.page').then(
        (m) => m.NewObservationPage
      ),
    // No patient in the title: `?patientId=` only seeds the form's select, so a name here would go
    // stale the moment the caregiver switches patients mid-entry.
    title: 'New observation',
    canActivate: [authGuard],
  },
  // After `observations/new`: routes match top-down, so the literal has to win over the parameter.
  {
    path: 'observations/:id',
    loadComponent: () =>
      import('./observations/observation-detail.page').then(
        (m) => m.ObservationDetailPage
      ),
    title: 'Observation',
    canActivate: [authGuard],
  },
  {
    path: 'interventions/new',
    loadComponent: () =>
      import('./interventions/new-intervention.page').then(
        (m) => m.NewInterventionPage
      ),
    title: 'New intervention',
    canActivate: [authGuard],
  },
  // Same top-down rule as `observations/:id` above.
  {
    path: 'interventions/:id',
    loadComponent: () =>
      import('./interventions/intervention-detail.page').then(
        (m) => m.InterventionDetailPage
      ),
    title: 'Intervention',
    canActivate: [authGuard],
  },
  {
    path: 'medications',
    loadComponent: () =>
      import('./medications/medications.page').then((m) => m.MedicationsPage),
    title: 'Medications',
    canActivate: [authGuard],
  },
  {
    path: 'medications/:id',
    loadComponent: () =>
      import('./medications/medication-detail.page').then(
        (m) => m.MedicationDetailPage
      ),
    title: 'Medication',
    canActivate: [authGuard],
  },
  {
    path: 'schedules/new',
    loadComponent: () =>
      import('./schedules/new-schedule.page').then((m) => m.NewSchedulePage),
    title: 'New schedule',
    canActivate: [authGuard],
  },
  {
    path: 'schedules/:id',
    loadComponent: () =>
      import('./schedules/schedule-detail.page').then(
        (m) => m.ScheduleDetailPage
      ),
    title: 'Schedule',
    canActivate: [authGuard],
  },
  // Household setup, moved off Home (frontend.md → "Information architecture (v2)" → Home:
  // "Catalog and admin actions leave Home"). Reached from the avatar menu.
  {
    path: 'manage',
    loadComponent: () =>
      import('./manage/manage.page').then((m) => m.ManagePage),
    title: 'Manage',
    canActivate: [authGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
    title: 'Home',
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];
