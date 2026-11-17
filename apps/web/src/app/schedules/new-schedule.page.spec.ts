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
      get: jest.fn((path: string) =>
        path.endsWith('/doses') ? of({ schedule: {}, linked: [], candidates: [] }) : of([{ id: 'p1', fullName: 'Patient 1' }]),
      ),
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
    // The household's zone, from the browser — never left to the server's clock.
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
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
    // A new schedule offers active medications only: retiring one is what keeps it out of here.
    expect(apiMock.get).toHaveBeenCalledWith('/medications', { q: 'amox', activeOnly: true });
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

  // frontend.md → Schedule detail → "Linking existing doses": doses already logged since the
  // schedule's start would read as missed, so the form hands over to the link list.
  it('opens the new schedule with its link list when matching doses were already logged', () => {
    apiMock.get.mockImplementation((path: string) =>
      path.endsWith('/doses')
        ? of({ schedule: {}, linked: [], candidates: [{ interventionId: 'i1' }] })
        : of([{ id: 'p1', fullName: 'Patient 1' }]),
    );
    apiMock.post.mockReturnValue(of({ id: 'sched-9' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', label: 'Cream q12h', medicationId: 'med-1', frequencyHours: 12 });
    comp.submit();
    expect(apiMock.get).toHaveBeenCalledWith('/schedules/sched-9/doses');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules', 'sched-9'], { queryParams: { link: '1' } });
  });

  // frontend.md → Episode detail → "Add a schedule": opened with the episode filled in, saved
  // under it, and back to the episode afterwards.
  it('prefills the episode from query params, saves under it, and returns to the episode', () => {
    queryParams = { patientId: 'p1', episodeId: 'ep1' };
    apiMock.post.mockReturnValue(of({ id: 'sched-3' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.form.getRawValue().episodeId).toBe('ep1');

    comp.form.patchValue({ label: 'Clotrimazole twice daily', medicationId: 'med-1', explicitTimesRaw: '08:00, 20:00' });
    comp.submit();
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/schedules', expect.objectContaining({ episodeId: 'ep1' }));
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
  });

  it('shows no amount boxes for a cream, and sends no amount', () => {
    apiMock.post.mockReturnValue(of({ id: 'sched-4' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.embodiments.set([{ id: 'emb-cream', label: '1% cream', dosageForm: 'cream', unitType: 'other' } as any]);
    comp.form.patchValue({ patientId: 'p1', label: 'Cream', medicationId: 'med-1', medicationEmbodimentId: 'emb-cream', frequencyHours: 12 });
    fixture.detectChanges();

    expect(comp.noAmountBoxes()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('No amount to measure for this form');
    expect(fixture.nativeElement.querySelector('input[formcontrolname=doseMg]')).toBeNull();

    comp.submit();
    const body = apiMock.post.mock.calls[0][1];
    expect(body.doseMg).toBeUndefined();
    expect(body.doseMl).toBeUndefined();
    expect(body.pillCount).toBeUndefined();
  });

  it('keeps the mg box for a tablet', () => {
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.embodiments.set([{ id: 'emb-tab', label: '200 mg tablet', dosageForm: 'tablet', unitType: 'tablet' } as any]);
    comp.form.patchValue({ medicationEmbodimentId: 'emb-tab' });
    expect(comp.showBox('mg')).toBe(true);
    expect(comp.showBox('ml')).toBe(false);
    expect(comp.amountBoxes().count).toBe('Tablets');
  });
});
