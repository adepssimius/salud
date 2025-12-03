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

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage },
  { path: 'register', component: RegisterPage },
  { path: 'logout', component: LogoutPage },
  { path: 'profile', component: ProfilePage },
  { path: 'patients/new', component: NewPatientPage },
  { path: 'patients/:id', component: PatientDetailPage },
  { path: 'observations/new', component: NewObservationPage },
  { path: 'interventions/new', component: NewInterventionPage },
  { path: 'dashboard', component: DashboardPage },
  { path: '**', redirectTo: 'login' },
];
