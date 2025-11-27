import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PatientDetailPage } from './patient-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('PatientDetailPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn(),
      patch: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigateByUrl: jest.fn(), navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } },
        },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads patient and care team', () => {
    apiMock.get.mockReturnValueOnce(
      of({
        id: 'p1',
        fullName: 'Pat One',
        dateOfBirth: '2010-01-01',
        sexAtBirth: 'female',
        notes: null,
        ownedById: 'u1',
        latestWeightKg: null,
        latestWeightRecordedAt: null,
        myRole: 'parent',
      }),
    );
    apiMock.get.mockReturnValueOnce(
      of([
        {
          user: { id: 'u1', email: 't@example.com', displayName: 'Tester' },
          role: 'parent',
        },
      ]),
    );

    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.patient()?.fullName).toBe('Pat One');
    expect(component.careTeam().length).toBe(1);
  });

  it('updates patient details', () => {
    apiMock.get.mockReturnValue(of({}));
    apiMock.patch.mockReturnValue(
      of({
        id: 'p1',
        fullName: 'Updated',
        dateOfBirth: '2010-01-01',
        sexAtBirth: 'female',
        notes: null,
        ownedById: 'u1',
        latestWeightKg: null,
        latestWeightRecordedAt: null,
        myRole: 'parent',
      }),
    );
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ fullName: 'Updated', dateOfBirth: '2010-01-01', sexAtBirth: 'female' });
    component.savePatient();
    expect(apiMock.patch).toHaveBeenCalled();
  });
});
