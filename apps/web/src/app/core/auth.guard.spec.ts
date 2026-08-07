import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard', () => {
  let authMock: { token: string | null };
  let routerMock: { parseUrl: jest.Mock };

  beforeEach(() => {
    authMock = { token: null };
    routerMock = { parseUrl: jest.fn((url: string) => `urlTree:${url}` as unknown as UrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  function runGuard() {
    return TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
  }

  it('allows navigation when a token is present', () => {
    authMock.token = 'jwt-token';
    expect(runGuard()).toBe(true);
    expect(routerMock.parseUrl).not.toHaveBeenCalled();
  });

  it('redirects to login when there is no token', () => {
    authMock.token = null;
    const result = runGuard();
    expect(routerMock.parseUrl).toHaveBeenCalledWith('/login');
    expect(result).toBe('urlTree:/login');
  });
});
