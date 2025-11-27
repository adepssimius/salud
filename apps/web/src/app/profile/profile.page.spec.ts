import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProfilePage } from './profile.page';
import { AuthService } from '../core/auth.service';
import { ApiClientService } from '../core/api-client.service';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';

describe('ProfilePage', () => {
  let authMock: any;
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        displayName: 'Tester',
        email: 't@example.com',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
        id: 'u1',
      }),
      me: jest.fn(),
      updateProfile: jest.fn(),
      logout: jest.fn(),
    };
    apiMock = {
      get: jest.fn().mockReturnValue(of({ patients: [] })),
    };
    routerMock = { navigateByUrl: jest.fn() };
    const routeMock = {
      snapshot: {
        queryParamMap: {
          get: (key: string) => null,
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();
  });

  it('prefills from user signal', () => {
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.form.getRawValue().displayName).toBe('Tester');
  });

  it('submits updates', () => {
    authMock.updateProfile.mockReturnValue(
      of({
        user: {
          displayName: 'Updated',
          email: 't@example.com',
          preferredTempUnit: 'C',
          preferredLengthUnit: 'in',
          preferredWeightUnit: 'lb',
          id: 'u1',
        },
      }),
    );
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      displayName: 'Updated',
      preferredTempUnit: 'C',
      preferredLengthUnit: 'in',
      preferredWeightUnit: 'lb',
    });
    component.submit();
    expect(authMock.updateProfile).toHaveBeenCalled();
    expect(component.form.getRawValue().preferredTempUnit).toBe('C');
  });

  it('loads patients when tab selected', () => {
    apiMock.get.mockReturnValue(
      of([
        {
          id: 'p1',
          fullName: 'Pat One',
          dateOfBirth: '2010-01-01',
          sexAtBirth: 'female',
          notes: null,
          ownedById: 'u1',
          latestWeightKg: null,
          latestWeightRecordedAt: null,
          myRole: 'parent',
        },
      ]),
    );
    const fixture = TestBed.createComponent(ProfilePage);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectTab('patients');
    expect(apiMock.get).toHaveBeenCalledWith('/users/u1/patients');
    expect(component.patients().length).toBe(1);
  });

  it('navigates to add patient', () => {
    const fixture = TestBed.createComponent(ProfilePage);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.startAddPatient();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/patients/new');
  });
});
