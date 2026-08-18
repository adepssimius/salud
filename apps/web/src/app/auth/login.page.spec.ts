import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { LoginPage } from './login.page';
import { AuthService } from '../core/auth.service';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let component: LoginPage;
  let authMock: { login: jest.Mock; authConfig: jest.Mock };

  // Called exactly once per test (never mid-test) — Angular's TestBed forbids reconfiguring an
  // already-instantiated module, so varying the authConfig response or the query params means
  // choosing them before this runs, not overriding a shared beforeEach afterward.
  async function setup(
    opts: {
      queryParams?: Record<string, string>;
      authConfigResult?: Observable<{ mode: 'oidc' | 'password' }>;
    } = {},
  ) {
    authMock = {
      login: jest.fn(),
      authConfig: jest.fn().mockReturnValue(opts.authConfigResult ?? of({ mode: 'password' })),
    };

    await TestBed.configureTestingModule({
      imports: [LoginPage, RouterTestingModule.withRoutes([])],
      providers: [
        { provide: AuthService, useValue: authMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(opts.queryParams ?? {}) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('does not submit when form is invalid', async () => {
    await setup();
    component.submit();
    expect(authMock.login).not.toHaveBeenCalled();
  });

  it('submits and navigates on success', async () => {
    await setup();
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true as any);

    authMock.login.mockReturnValue(
      of({
        token: 't',
        user: {
          id: 'u1',
          email: 'a@example.com',
          displayName: 'A',
          preferredTempUnit: 'F',
          preferredLengthUnit: 'cm',
          preferredWeightUnit: 'kg',
        },
      }),
    );

    component.form.setValue({ email: 'a@example.com', password: 'pw' });
    component.submit();

    expect(authMock.login).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'pw',
    });
    expect(navSpy).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a plain sentence for a known error code, not the raw code', async () => {
    await setup();
    authMock.login.mockReturnValue(
      throwError(() => ({ error: { message: 'INVALID_CREDENTIALS' } })),
    );
    component.form.setValue({ email: 'a@example.com', password: 'pw' });
    component.submit();
    expect(component.error()).toBe('That email and password do not match an account. Check both and try again.');
    expect(component.error()).not.toContain('INVALID_CREDENTIALS');
  });

  it('falls back to a generic message for framework prose it cannot map', async () => {
    // Regression guard: this is exactly how a raw code used to reach the login screen.
    await setup();
    authMock.login.mockReturnValue(
      throwError(() => ({ error: { message: 'Unauthorized' } })),
    );
    component.form.setValue({ email: 'a@example.com', password: 'pw' });
    component.submit();
    expect(component.error()).toBe('Unable to sign in. Please try again.');
  });

  it('defaults to password mode and asks the API which mode is active', async () => {
    await setup();
    expect(authMock.authConfig).toHaveBeenCalled();
    expect(component.mode()).toBe('password');
  });

  it('switches to oidc mode when the API reports it', async () => {
    await setup({ authConfigResult: of({ mode: 'oidc' }) });
    expect(component.mode()).toBe('oidc');
  });

  it('stays on password mode if /auth/config itself is unreachable', async () => {
    await setup({ authConfigResult: throwError(() => new Error('network error')) });
    expect(component.mode()).toBe('password');
  });

  it('maps a known oidc error query param to a plain sentence', async () => {
    await setup({ queryParams: { error: 'oidc_forbidden' } });
    expect(component.oidcError()).toContain('salud_users');
  });

  it('falls back to a generic sentence for an unrecognized oidc error param', async () => {
    await setup({ queryParams: { error: 'something_new' } });
    expect(component.oidcError()).toBe('Sign-in failed. Try again.');
  });
});
