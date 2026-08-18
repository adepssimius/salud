import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { RegisterPage } from './register.page';
import { AuthService } from '../core/auth.service';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let component: RegisterPage;
  let authMock: { register: jest.Mock; authConfig: jest.Mock };
  let navSpy: jest.SpyInstance;

  // Defaults to password mode, which is what every pre-existing test here assumes: the form is
  // reachable and submittable. The OIDC-mode tests pass their own value.
  async function setup(authConfigResult?: Observable<{ mode: 'oidc' | 'password' }>) {
    authMock = {
      register: jest.fn(),
      authConfig: jest.fn().mockReturnValue(authConfigResult ?? of({ mode: 'password' })),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterPage, RouterTestingModule.withRoutes([])],
      providers: [
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();

    // Spy before first change detection: ngOnInit's redirect fires during detectChanges().
    navSpy = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true as any);

    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('does not submit when form is invalid', async () => {
    await setup();
    component.submit();
    expect(authMock.register).not.toHaveBeenCalled();
  });

  it('submits and navigates on success', async () => {
    await setup();

    authMock.register.mockReturnValue(
      of({
        token: 't',
        user: {
          id: 'u1',
          email: 'b@example.com',
          displayName: 'B',
          preferredTempUnit: 'F',
          preferredLengthUnit: 'cm',
          preferredWeightUnit: 'kg',
        },
      }),
    );

    component.form.setValue({
      displayName: 'B',
      email: 'b@example.com',
      password: 'password',
      preferredTempUnit: 'F',
      preferredLengthUnit: 'cm',
      preferredWeightUnit: 'kg',
    });
    component.submit();

    expect(authMock.register).toHaveBeenCalledWith({
      displayName: 'B',
      email: 'b@example.com',
      password: 'password',
      preferredTempUnit: 'F',
      preferredLengthUnit: 'cm',
      preferredWeightUnit: 'kg',
    });
    expect(navSpy).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a plain sentence for a known error code', async () => {
    await setup();
    authMock.register.mockReturnValue(
      throwError(() => ({ error: { message: 'EMAIL_TAKEN' } })),
    );
    component.form.patchValue({
      displayName: 'B',
      email: 'b@example.com',
      password: 'password',
    });
    component.submit();
    expect(component.error()).toBe('An account with that email already exists. Try signing in instead.');
  });

  it('redirects to login when the API reports OIDC mode', async () => {
    // The dead end this fixes: nothing links here in OIDC mode, but a bookmark or browser
    // autocomplete still resolves the route, and every submission would 403 with
    // PASSWORD_AUTH_DISABLED.
    await setup(of({ mode: 'oidc' }));
    expect(authMock.authConfig).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith('/login');
  });

  it('stays put in password mode so local dev can still register', async () => {
    await setup(of({ mode: 'password' }));
    expect(navSpy).not.toHaveBeenCalledWith('/login');
  });

  it('leaves the form up if /auth/config is unreachable', async () => {
    await setup(throwError(() => new Error('network error')));
    expect(navSpy).not.toHaveBeenCalledWith('/login');
  });
});
