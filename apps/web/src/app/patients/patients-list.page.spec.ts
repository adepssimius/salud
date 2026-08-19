import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { PatientsListPage } from './patients-list.page';
import { AuthService } from '../core/auth.service';
import { ApiClientService } from '../core/api-client.service';

const patient = {
  id: 'p1',
  fullName: 'Pat One',
  dateOfBirth: '2010-01-01',
  sexAtBirth: 'female',
  notes: null,
  ownedById: 'u1',
  latestWeightKg: null,
  latestWeightRecordedAt: null,
  myRole: 'parent',
  codeStatus: null,
  codeStatusSetByUserId: null,
  codeStatusSetAt: null,
};

describe('PatientsListPage', () => {
  let authMock: any;
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    apiMock = { get: jest.fn().mockReturnValue(of([])) };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientsListPage],
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads patients on init', () => {
    apiMock.get.mockReturnValue(of([patient]));
    const fixture = TestBed.createComponent(PatientsListPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/patients');
    expect(fixture.componentInstance.patients().length).toBe(1);
  });

  it('accepts the wrapped response shape too', () => {
    apiMock.get.mockReturnValue(of({ patients: [patient] }));
    const fixture = TestBed.createComponent(PatientsListPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.patients().length).toBe(1);
  });

  it('shows a message when the list cannot be loaded', () => {
    // An unreachable API must not render as "you have no patients".
    apiMock.get.mockReturnValue(throwError(() => ({ error: { message: 'boom' } })));
    const fixture = TestBed.createComponent(PatientsListPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.error()).toBe('Unable to load patients right now.');
    expect(component.loading()).toBe(false);
  });

  it('navigates into a patient and to the create form', () => {
    const fixture = TestBed.createComponent(PatientsListPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.goToPatient('p1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1']);
    component.startAddPatient();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/patients/new');
  });
});
