import { Route } from '@angular/router';
import { LoginPage } from './auth/login.page';
import { RegisterPage } from './auth/register.page';
import { LogoutPage } from './auth/logout.page';
import { DashboardPage } from './dashboard/dashboard.page';
import { ProfilePage } from './profile/profile.page';
import { NewPatientPage } from './patients/new-patient.page';
import { PatientDetailPage } from './patients/patient-detail.page';
import { NewObservationPage } from './observations/new-observation.page';
import { NewInterventionPage } from './interventions/new-intervention.page';
import { MedicationsPage } from './medications/medications.page';
import { MedicationDetailPage } from './medications/medication-detail.page';
import { NewSchedulePage } from './schedules/new-schedule.page';
import { ScheduleDetailPage } from './schedules/schedule-detail.page';
import { TimelinePage } from './timeline/timeline.page';
import { NewConditionPage } from './conditions/new-condition.page';
import { ConditionDetailPage } from './conditions/condition-detail.page';
import { EpisodeDetailPage } from './episodes/episode-detail.page';
import { ErBriefPage } from './er-brief/er-brief.page';
import { SharedBriefPage } from './er-brief/shared-brief.page';
import { WhatsNewPage } from './whats-new/whats-new.page';
import { authGuard } from './core/auth.guard';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage },
  { path: 'register', component: RegisterPage },
  { path: 'logout', component: LogoutPage },
  { path: 'profile', component: ProfilePage, canActivate: [authGuard] },
  { path: 'patients/new', component: NewPatientPage, canActivate: [authGuard] },
  { path: 'patients/:id', component: PatientDetailPage, canActivate: [authGuard] },
  { path: 'patients/:id/timeline', component: TimelinePage, canActivate: [authGuard] },
  { path: 'patients/:id/conditions/new', component: NewConditionPage, canActivate: [authGuard] },
  { path: 'conditions/:id', component: ConditionDetailPage, canActivate: [authGuard] },
  { path: 'episodes/:id', component: EpisodeDetailPage, canActivate: [authGuard] },
  { path: 'patients/:id/er-brief', component: ErBriefPage, canActivate: [authGuard] },
  { path: 'brief/:token', component: SharedBriefPage },
  { path: 'patients/:id/whats-new', component: WhatsNewPage, canActivate: [authGuard] },
  { path: 'observations/new', component: NewObservationPage, canActivate: [authGuard] },
  { path: 'interventions/new', component: NewInterventionPage, canActivate: [authGuard] },
  { path: 'medications', component: MedicationsPage, canActivate: [authGuard] },
  { path: 'medications/:id', component: MedicationDetailPage, canActivate: [authGuard] },
  { path: 'schedules/new', component: NewSchedulePage, canActivate: [authGuard] },
  { path: 'schedules/:id', component: ScheduleDetailPage, canActivate: [authGuard] },
  { path: 'dashboard', component: DashboardPage, canActivate: [authGuard] },
  { path: '**', redirectTo: 'login' },
];
