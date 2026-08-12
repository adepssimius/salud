import { Route } from '@angular/router';
import { authGuard } from './core/auth.guard';

// Every page is loaded lazily, including login. Importing them statically put all 21 pages — and
// @angular/forms, which only pages use — into the initial bundle, which is what pushed it 72 kB past
// the 500 kB budget. Keeping login eager to save one round-trip would drag forms back in on its own.
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage) },
  { path: 'register', loadComponent: () => import('./auth/register.page').then((m) => m.RegisterPage) },
  { path: 'logout', loadComponent: () => import('./auth/logout.page').then((m) => m.LogoutPage) },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then((m) => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/new',
    loadComponent: () => import('./patients/new-patient.page').then((m) => m.NewPatientPage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id',
    loadComponent: () => import('./patients/patient-detail.page').then((m) => m.PatientDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'patients/:id/timeline',
    loadComponent: () => import('./timeline/timeline.page').then((m) => m.TimelinePage),
    canActivate: [authGuard],
  },
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
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];
