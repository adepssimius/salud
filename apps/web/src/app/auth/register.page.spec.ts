import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { RegisterPage } from './register.page';
import { AuthService } from '../core/auth.service';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let component: RegisterPage;
  let authMock: { register: jest.Mock };

  beforeEach(async () => {
    authMock = {
      register: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterPage, RouterTestingModule.withRoutes([])],
      providers: [
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not submit when form is invalid', () => {
    component.submit();
    expect(authMock.register).not.toHaveBeenCalled();
  });

  it('submits and navigates on success', () => {
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true as any);

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

  it('shows error on failure', () => {
    authMock.register.mockReturnValue(
      throwError(() => ({ error: { message: 'Email exists' } })),
    );
    component.form.patchValue({
      displayName: 'B',
      email: 'b@example.com',
      password: 'password',
    });
    component.submit();
    expect(component.error()).toBe('Email exists');
  });
});
