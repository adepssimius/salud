import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { LoginPage } from './login.page';
import { AuthService } from '../core/auth.service';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let component: LoginPage;
  let authMock: { login: jest.Mock };

  beforeEach(async () => {
    authMock = {
      login: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LoginPage, RouterTestingModule.withRoutes([])],
      providers: [
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not submit when form is invalid', () => {
    component.submit();
    expect(authMock.login).not.toHaveBeenCalled();
  });

  it('submits and navigates on success', () => {
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

  it('shows error on failure', () => {
    authMock.login.mockReturnValue(
      throwError(() => ({ error: { message: 'Invalid' } })),
    );
    component.form.setValue({ email: 'a@example.com', password: 'pw' });
    component.submit();
    expect(component.error()).toBe('Invalid');
  });
});
