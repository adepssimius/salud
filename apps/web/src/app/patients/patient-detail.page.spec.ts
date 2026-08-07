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

  it('loads patient, care team, and conditions', () => {
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
        codeStatus: null,
        codeStatusSetByUserId: null,
        codeStatusSetAt: null,
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
    apiMock.get.mockReturnValueOnce(
      of([{ id: 'c1', patientId: 'p1', name: 'ALL treatment', status: 'active' }]),
    );
    apiMock.get.mockReturnValueOnce(of([]));

    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.patient()?.fullName).toBe('Pat One');
    expect(component.careTeam().length).toBe(1);
    expect(component.conditions().length).toBe(1);
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/conditions');
  });

  it('sets code status via the dedicated endpoint', () => {
    apiMock.get.mockReturnValue(
      of({
        id: 'p1',
        codeStatus: null,
        codeStatusSetByUserId: null,
        codeStatusSetAt: null,
      }),
    );
    apiMock.patch.mockReturnValue(
      of({
        id: 'p1',
        fullName: 'Pat One',
        codeStatus: 'Full code',
        codeStatusSetByUserId: 'u1',
        codeStatusSetAt: 1700000000,
      }),
    );
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.startEditCodeStatus();
    component.codeStatusDraft = 'Full code';
    component.saveCodeStatus();

    expect(apiMock.patch).toHaveBeenCalledWith('/patients/p1/code-status', { codeStatus: 'Full code' });
    expect(component.patient()?.codeStatus).toBe('Full code');
    expect(component.editingCodeStatus()).toBe(false);
  });

  it('shows the code status age in relative time, and blank when unset', () => {
    const fourteenMonthsAgo = Math.floor(Date.now() / 1000) - 14 * 30 * 86400;
    apiMock.get.mockReturnValueOnce(
      of({
        id: 'p1',
        codeStatus: 'DNR',
        codeStatusSetByUserId: 'u1',
        codeStatusSetAt: fourteenMonthsAgo,
      }),
    );
    apiMock.get.mockReturnValueOnce(of([]));
    apiMock.get.mockReturnValueOnce(of([]));
    apiMock.get.mockReturnValueOnce(of([]));
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.codeStatusAge()).toBe('14 months ago');

    component.patient.set({ ...component.patient()!, codeStatusSetAt: null } as any);
    expect(component.codeStatusAge()).toBe('');
  });

  it('navigates to new-condition and condition-detail', () => {
    apiMock.get.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.goToNewCondition();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'conditions', 'new']);

    component.goToCondition('c1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/conditions', 'c1']);
  });

  it('goToErBrief navigates to the ER Brief page', () => {
    apiMock.get.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.goToErBrief();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'er-brief']);
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

  it('deletes patient and navigates back', () => {
    apiMock.get.mockReturnValue(of({}));
    apiMock.delete.mockReturnValue(of({ deleted: true }));
    const fixture = TestBed.createComponent(PatientDetailPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    component.deletePatient();
    expect(apiMock.delete).toHaveBeenCalledWith('/patients/p1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/profile'], { queryParams: { tab: 'patients' } });
  });
});
