import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('auth guards', () => {
  let authMock: { hasSession: jest.Mock };
  let routerMock: { parseUrl: jest.Mock };

  beforeEach(() => {
    authMock = { hasSession: jest.fn(() => false) };
    routerMock = { parseUrl: jest.fn((url: string) => `urlTree:${url}` as unknown as UrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  const run = (guard: typeof authGuard) =>
    TestBed.runInInjectionContext(() => guard({} as any, {} as any));

  describe('authGuard', () => {
    it('allows navigation with a live session', () => {
      authMock.hasSession.mockReturnValue(true);
      expect(run(authGuard)).toBe(true);
      expect(routerMock.parseUrl).not.toHaveBeenCalled();
    });

    it('redirects to login without one', () => {
      expect(run(authGuard)).toBe('urlTree:/login');
    });
  });

  describe('guestGuard', () => {
    it('sends a signed-in caregiver to the dashboard', () => {
      authMock.hasSession.mockReturnValue(true);
      expect(run(guestGuard)).toBe('urlTree:/dashboard');
    });

    it('lets a signed-out visitor through', () => {
      expect(run(guestGuard)).toBe(true);
    });
  });
});
