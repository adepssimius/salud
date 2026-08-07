import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

// Sign-in and sign-up legitimately answer 401 for a wrong password; that must not be treated as an
// expired session (it would log the user out mid-attempt and bounce them off the login page).
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register'];

const isAuthEndpoint = (url: string) => AUTH_ENDPOINTS.some((path) => url.includes(path));

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  if (!token) {
    return next(req);
  }
  const authReq: HttpRequest<unknown> = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
  return next(authReq).pipe(
    catchError((err: unknown) => {
      // A 401 on a token-bearing request means the session is gone (expired or revoked). Ending it
      // here is what frontend.md → "App shell & routing" promises; without it every page just shows
      // its own generic "could not save" and the caregiver has no route back to sign-in.
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthEndpoint(req.url)) {
        auth.logout();
      }
      return throwError(() => err);
    }),
  );
};
