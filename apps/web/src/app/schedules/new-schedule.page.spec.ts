import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewSchedulePage } from './new-schedule.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('NewSchedulePage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let queryParams: Record<string, string>;

  beforeEach(async () => {
    queryParams = {};
    apiMock = {
      get: jest.fn().mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }])),
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewSchedulePage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (key: string) => queryParams[key] ?? null } } },
        },
      ],
    }).compileComponents();
  });

  it('loads patients and creates a frequency-based medication schedule', () => {
    apiMock.post.mockReturnValue(of({ id: 'sched-1' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({
      patientId: 'p1',
      label: 'Amoxicillin q8h',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseMg: 400,
      frequencyHours: 8,
      startAt: '2026-01-01T08:00',
      endAfterOccurrences: 10,
    });
    comp.submit();

    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/schedules',
      expect.objectContaining({
        type: 'medication_dose',
        label: 'Amoxicillin q8h',
        medicationId: 'med-1',
        doseMg: 400,
        frequencyHours: 8,
        endAfterOccurrences: 10,
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('parses comma-separated explicitTimes and omits frequencyHours', () => {
    apiMock.post.mockReturnValue(of({ id: 'sched-2' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({
      patientId: 'p1',
      label: 'Nightly dressing',
      type: 'dressing_change',
      bodyLocation: 'Left knee',
      explicitTimesRaw: '08:00, 20:00',
      startAt: '2026-01-01T08:00',
    });
    comp.submit();

    const body = apiMock.post.mock.calls[0][1];
    expect(body.explicitTimes).toEqual(['08:00', '20:00']);
    expect(body.frequencyHours).toBeUndefined();
    expect(body.bodyLocation).toBe('Left knee');
  });

  it('shows an error on failure', () => {
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'BODY_LOCATION_REQUIRED' } })));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({
      patientId: 'p1',
      label: 'x',
      type: 'medication_dose',
      medicationId: 'med-1',
      frequencyHours: 8,
      startAt: '2026-01-01T08:00',
    });
    comp.submit();
    expect(comp.error()).toBe('A dressing change needs a body location. Add one and try again.');
  });

  it('searches and selects a medication, loading its embodiments', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') {
        return of([{ id: 'med-1', name: 'amoxicillin', brandNames: [], description: null, tags: [], defaultActive: true, createdAt: 0, updatedAt: 0 }]);
      }
      if (path.includes('/embodiments')) {
        return of([{ id: 'emb-1', medicationId: 'med-1', label: 'suspension', concentrationMgPerMl: 40, strengthMgPerUnit: null, unitType: 'ml', notes: null, atHome: true, expiresAt: null, runningLow: false, runningLowFlaggedByUserId: null, runningLowFlaggedAt: null }]);
      }
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.onMedicationQueryChange({ target: { value: 'amox' } } as unknown as Event);
    expect(comp.medicationResults().length).toBe(1);
    comp.selectMedication(comp.medicationResults()[0]);
    expect(comp.selectedMedication()?.id).toBe('med-1');
    expect(comp.embodiments().length).toBe(1);

    comp.clearMedication();
    expect(comp.selectedMedication()).toBeNull();
  });

  it('cancel navigates to dashboard', () => {
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    fixture.componentInstance.cancel();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('prefills patient and conditionId from query params and omits episodeId', () => {
    queryParams = { conditionId: 'cond-1', patientId: 'p1' };
    apiMock.post.mockReturnValue(of({ id: 'sched-3' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.form.getRawValue().patientId).toBe('p1');
    expect(comp.form.getRawValue().conditionId).toBe('cond-1');

    comp.form.patchValue({
      label: 'Insulin q12h',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseMg: 10,
      frequencyHours: 12,
      startAt: '2026-01-01T08:00',
    });
    comp.submit();

    const body = apiMock.post.mock.calls[0][1];
    expect(body.conditionId).toBe('cond-1');
    expect(body.episodeId).toBeUndefined();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/conditions', 'cond-1']);
  });
});
