import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Guarded pages: no live session → `/login`. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.hasSession()) {
    return true;
  }
  return router.parseUrl('/login');
};

/**
 * The inverse, for `/login` and `/register`: a signed-in caregiver who opens either — a bookmark,
 * a stale tab, the bare domain — goes to Home instead of a sign-in form drawn inside the signed-in
 * shell. Decided before the page renders, so there is no flash of the form.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.hasSession()) {
    return router.parseUrl('/dashboard');
  }
  return true;
};
