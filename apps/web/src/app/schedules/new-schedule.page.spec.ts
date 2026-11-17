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

  it('sends "N times a day" as its times of day and omits frequencyHours', () => {
    apiMock.post.mockReturnValue(of({ id: 'sched-2' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({
      patientId: 'p1',
      label: 'Nightly dressing',
      type: 'dressing_change',
      bodyLocation: 'Left knee',
      timesPerDay: 2,
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

    comp.form.patchValue({ label: 'Clotrimazole twice daily', medicationId: 'med-1', timesPerDay: 2 });
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

  // frontend.md → New schedule form → "The name": prefilled the way a nurse would say it, following
  // the form until the caregiver types their own, and handed back when they empty it.
  describe('the generated name', () => {
    const tablet = { id: 'emb-tab', medicationId: 'med-1', label: '500 mg tablet', dosageForm: 'tablet', unitType: 'tablet', strengthMgPerUnit: 500 };

    const build = () => {
      const fixture = TestBed.createComponent(NewSchedulePage);
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      comp.selectedMedication.set({ id: 'med-1', name: 'acetaminophen', brandNames: [] } as any);
      comp.embodiments.set([tablet as any]);
      return { fixture, comp };
    };

    it('follows the choices above until the caregiver types a name', () => {
      const { comp } = build();
      comp.form.patchValue({ medicationId: 'med-1', medicationEmbodimentId: 'emb-tab', doseMg: 500, frequencyHours: 6 });
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen q6h');
      comp.form.patchValue({ frequencyHours: 8 });
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen q8h');

      comp.form.controls.label.setValue('Tylenol for the fever');
      comp.form.patchValue({ frequencyHours: 4 });
      expect(comp.form.controls.label.value).toBe('Tylenol for the fever');

      comp.form.controls.label.setValue('');
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen q4h');
    });

    it('fills the tablet count from the mg through the strength, as the dose form does', () => {
      const { comp } = build();
      comp.form.patchValue({ medicationId: 'med-1', medicationEmbodimentId: 'emb-tab' });
      comp.form.controls.doseMg.setValue(1000);
      expect(comp.form.controls.pillCount.value).toBe(2);
      expect(comp.showBox('ml')).toBe(false);
      expect(comp.countLabel()).toBe('Tablets');
    });

    it("shows the patient's dose guidance and fills the amounts from Use this", () => {
      jest.useFakeTimers();
      const { fixture, comp } = build();
      apiMock.post.mockReturnValue(
        of({ guidance: { weightBased: null, ageBand: { doseMg: 480, doseMl: null, pillCount: null, source: 'label', frequencyPerDay: 4, maxMgPerDay: 2000, doseMlSource: null } }, advisories: [], nextAllowedAt: null, dailyTotalMg: 0 }),
      );
      comp.form.patchValue({ patientId: 'p1', medicationId: 'med-1', medicationEmbodimentId: 'emb-tab', frequencyHours: 6 });
      jest.advanceTimersByTime(450);
      fixture.detectChanges();
      expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/dose-checks', expect.objectContaining({ medicationId: 'med-1' }));
      expect(fixture.nativeElement.querySelector('app-dose-guidance').textContent).toContain('Age-band');
      comp.useAgeBandAmount();
      expect(comp.form.controls.doseMg.value).toBe(480);
      expect(comp.form.controls.label.value).toBe('480 mg Acetaminophen q6h');
      jest.useRealTimers();
    });

    it('switches to the dressing fields when the type changes', () => {
      const { fixture, comp } = build();
      comp.form.patchValue({ type: 'dressing_change', bodyLocation: 'knee', side: 'left', frequencyHours: 24 });
      fixture.detectChanges();
      expect(comp.isMedication()).toBe(false);
      expect(fixture.nativeElement.querySelector('input[formcontrolname=bodyLocation]')).not.toBeNull();
      expect(comp.form.controls.label.value).toBe('Dressing change, left knee daily');
    });
  });

  // frontend.md → New schedule form → "How often": q6h and QID are different instructions.
  describe('how often', () => {
    it('keeps a strict interval apart from times a day', () => {
      apiMock.post.mockReturnValue(of({ id: 's' }));
      const fixture = TestBed.createComponent(NewSchedulePage);
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      comp.selectedMedication.set({ id: 'med-1', name: 'acetaminophen', brandNames: [] } as any);

      comp.form.patchValue({ patientId: 'p1', medicationId: 'med-1', doseMg: 500, frequencyHours: 6 });
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen q6h');

      comp.form.controls.timesPerDay.setValue(4);
      fixture.detectChanges();
      expect(comp.isDaily()).toBe(true);
      expect(comp.dailyTimes.value).toEqual(['08:00', '12:00', '16:00', '20:00']);
      expect(fixture.nativeElement.querySelectorAll('.daily-times input[type=time]')).toHaveLength(4);
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen QID (08:00, 12:00, 16:00, 20:00)');

      comp.dailyTimes.at(0).setValue('09:00');
      expect(comp.form.controls.label.value).toBe('500 mg Acetaminophen QID (09:00, 12:00, 16:00, 20:00)');

      comp.submit();
      const body = apiMock.post.mock.calls[0][1];
      expect(body.explicitTimes).toEqual(['09:00', '12:00', '16:00', '20:00']);
      expect(body.frequencyHours).toBeUndefined();
    });

    it('marks the interval strict, with the explanation in a tooltip rather than on the page', () => {
      const fixture = TestBed.createComponent(NewSchedulePage);
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      comp.form.controls.frequencyHours.setValue(6);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.how-often')!.textContent).toContain('(strict)');
      const tips = el.querySelectorAll('app-info-tip');
      expect(tips).toHaveLength(2);
      const tipText = tips[0].querySelector('.info-tip-text') as HTMLElement;
      expect(tipText.classList.contains('open')).toBe(false);
      (tips[0].querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(tipText.classList.contains('open')).toBe(true);
      // The clock, never a count per day — "4 a day" is the other instruction.
      expect(comp.intervalExample()).toBe('Every 6 hours: 08:00 → 14:00 → 20:00 → 02:00 → 08:00 → … around the clock.');
      expect(tipText.textContent).not.toMatch(/a day/);
      comp.form.controls.frequencyHours.setValue(5);
      expect(comp.intervalExample()).toBe('Every 5 hours: 08:00 → 13:00 → 18:00 → 23:00 → 04:00 → … around the clock.');
      comp.form.controls.frequencyHours.setValue(24);
      expect(comp.intervalExample()).toBeNull();
    });

    it('goes back to the strict interval when hours are typed', () => {
      const fixture = TestBed.createComponent(NewSchedulePage);
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      comp.form.controls.timesPerDay.setValue(3);
      comp.form.controls.frequencyHours.setValue(8);
      expect(comp.isDaily()).toBe(false);
    });
  });

  // frontend.md → New schedule form → "If a dose is missed".
  it('sends the missed-dose instruction, the cutoff only with a take-late action and the effect only with an end', () => {
    apiMock.post.mockReturnValue(of({ id: 's' }));
    const fixture = TestBed.createComponent(NewSchedulePage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({
      patientId: 'p1',
      label: 'Amox q8h',
      medicationId: 'med-1',
      frequencyHours: 8,
      missedDoseAction: 'take_late_keep_times',
      missedDoseCutoffHours: 2,
      missedDoseCourseEffect: 'finish_every_dose',
      missedDoseNote: ' per the pharmacist ',
    });
    fixture.detectChanges();
    expect(comp.isTakeLate()).toBe(true);
    expect(fixture.nativeElement.querySelector('input[formcontrolname=missedDoseCutoffHours]')).not.toBeNull();
    // No end yet: the course effect is neither shown nor sent.
    expect(fixture.nativeElement.querySelector('select[formcontrolname=missedDoseCourseEffect]')).toBeNull();
    comp.submit();
    let body = apiMock.post.mock.calls[0][1];
    expect(body).toMatchObject({ missedDoseAction: 'take_late_keep_times', missedDoseCutoffHours: 2, missedDoseNote: 'per the pharmacist' });
    expect(body.missedDoseCourseEffect).toBeUndefined();

    comp.form.patchValue({ endAfterOccurrences: 10, missedDoseAction: 'skip' });
    comp.submit();
    body = apiMock.post.mock.calls[1][1];
    expect(body).toMatchObject({ missedDoseAction: 'skip', missedDoseCourseEffect: 'finish_every_dose' });
    expect(body.missedDoseCutoffHours).toBeUndefined();
  });
});
