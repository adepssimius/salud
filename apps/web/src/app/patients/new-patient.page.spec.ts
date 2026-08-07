import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewPatientPage } from './new-patient.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { Router } from '@angular/router';

describe('NewPatientPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        id: 'u1',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
        email: 't@example.com',
      }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewPatientPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('submits to create patient', () => {
    apiMock.post.mockReturnValue(of({ patient: {} }));
    const fixture = TestBed.createComponent(NewPatientPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      fullName: 'Pat One',
      dateOfBirth: '2010-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    });
    component.submit();
    expect(apiMock.post).toHaveBeenCalledWith('/patients', expect.objectContaining({ fullName: 'Pat One' }));
    expect(routerMock.navigate).toHaveBeenCalledWith(['/profile'], { queryParams: { tab: 'patients' } });
  });

  it('shows error on failure', () => {
    apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(NewPatientPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      fullName: 'Pat One',
      dateOfBirth: '2010-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    });
    component.submit();
    expect(component.error()).toBe('Could not create patient right now.');
  });
});
