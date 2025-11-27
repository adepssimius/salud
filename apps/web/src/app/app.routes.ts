import { Route } from '@angular/router';
import { LoginPage } from './auth/login.page';
import { RegisterPage } from './auth/register.page';
import { LogoutPage } from './auth/logout.page';
import { DashboardPage } from './dashboard/dashboard.page';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage },
  { path: 'register', component: RegisterPage },
  { path: 'logout', component: LogoutPage },
  { path: 'dashboard', component: DashboardPage },
  { path: '**', redirectTo: 'login' },
];
