import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpRequest, HttpResponse, HttpHandlerFn } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let authMock: { token: string | null; logout: jest.Mock };

  function run(req: HttpRequest<unknown>, next: HttpHandlerFn) {
    return TestBed.runInInjectionContext(() => authInterceptor(req, next));
  }

  beforeEach(() => {
    authMock = { token: 'jwt-123', logout: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: authMock }],
    });
  });

  it('attaches the bearer token', (done) => {
    const next: HttpHandlerFn = (req) => {
      expect(req.headers.get('Authorization')).toBe('Bearer jwt-123');
      return of(new HttpResponse({ status: 200 }));
    };
    run(new HttpRequest('GET', '/api/patients'), next).subscribe(() => done());
  });

  it('passes the request through untouched when there is no token', (done) => {
    authMock.token = null;
    const next: HttpHandlerFn = (req) => {
      expect(req.headers.has('Authorization')).toBe(false);
      return of(new HttpResponse({ status: 200 }));
    };
    run(new HttpRequest('GET', '/api/patients'), next).subscribe(() => done());
  });

  it('logs out and rethrows on a 401 for a token-bearing request', (done) => {
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 401, url: '/api/patients' }));

    run(new HttpRequest('GET', '/api/patients'), next).subscribe({
      error: (err) => {
        expect(authMock.logout).toHaveBeenCalled();
        expect(err.status).toBe(401);
        done();
      },
    });
  });

  it('does not log out when sign-in itself returns 401', (done) => {
    // A wrong password must not end an existing session or bounce the user off the login page.
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 401, url: '/api/auth/login' }));

    run(new HttpRequest('POST', '/api/auth/login', {}), next).subscribe({
      error: () => {
        expect(authMock.logout).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does not log out when sign-up returns 401', (done) => {
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 401, url: '/api/auth/register' }));

    run(new HttpRequest('POST', '/api/auth/register', {}), next).subscribe({
      error: () => {
        expect(authMock.logout).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('leaves non-401 errors alone', (done) => {
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 500, url: '/api/patients' }));

    run(new HttpRequest('GET', '/api/patients'), next).subscribe({
      error: (err) => {
        expect(authMock.logout).not.toHaveBeenCalled();
        expect(err.status).toBe(500);
        done();
      },
    });
  });
});
