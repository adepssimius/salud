import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewInterventionPage } from './new-intervention.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('NewInterventionPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let routeMock: any;
  let scheduleIdParam: string | null;

  beforeEach(async () => {
    scheduleIdParam = null;
    apiMock = {
      get: jest.fn(),
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
    routeMock = {
      snapshot: { queryParamMap: { get: jest.fn(() => scheduleIdParam) } },
    };

    await TestBed.configureTestingModule({
      imports: [NewInterventionPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();
  });

  it('loads patients and submits medication dose', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/episodes')) {
        return of([{ id: 'ep1', name: 'Episode 1' }]);
      }
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });
    apiMock.post.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseSource: 'override',
      amountMg: 100,
      episodeSelection: ['ep1'],
      resolveSelected: true,
    });
    component.submit();
    expect(apiMock.get).toHaveBeenCalledWith('/patients');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/interventions',
      expect.objectContaining({
        type: 'medication_dose',
        medicationId: 'med-1',
        amountMg: 100,
        episodeIds: ['ep1'],
        resolvesEpisodeIds: ['ep1'],
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('shows error on failure', () => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseSource: 'override',
      amountMg: 100,
    });
    component.submit();
    expect(component.error()).toBeDefined();
  });

  it('searches medications and selects one, loading its embodiments', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') {
        return of([{ id: 'med-1', name: 'acetaminophen', brandNames: ['Tylenol'], description: null, tags: [], defaultActive: true, createdAt: 0, updatedAt: 0 }]);
      }
      if (path.includes('/embodiments')) {
        return of([
          {
            id: 'emb-1',
            medicationId: 'med-1',
            label: '160mg/5mL suspension',
            concentrationMgPerMl: 32,
            strengthMgPerUnit: null,
            unitType: 'ml',
            notes: null,
            atHome: true,
            expiresAt: null,
            runningLow: false,
            runningLowFlaggedByUserId: null,
            runningLowFlaggedAt: null,
          },
        ]);
      }
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.onMedicationQueryChange({ target: { value: 'tylenol' } } as unknown as Event);
    expect(apiMock.get).toHaveBeenCalledWith('/medications', { q: 'tylenol' });
    expect(component.medicationResults().length).toBe(1);

    component.selectMedication(component.medicationResults()[0] ?? {
      id: 'med-1',
      name: 'acetaminophen',
      brandNames: ['Tylenol'],
      description: null,
      tags: [],
      defaultActive: true,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(component.selectedMedication()?.id).toBe('med-1');
    expect(component.form.getRawValue().medicationId).toBe('med-1');
    expect(component.embodiments().length).toBe(1);
    expect(component.embodiments()[0].atHome).toBe(true);

    component.clearMedication();
    expect(component.selectedMedication()).toBeNull();
    expect(component.form.getRawValue().medicationId).toBe('');
    expect(component.embodiments().length).toBe(0);
  });

  it('flags an embodiment as expired when its expiresAt is in the past', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const expired = { expiresAt: Math.floor(Date.now() / 1000) - 86400 } as any;
    const notExpired = { expiresAt: Math.floor(Date.now() / 1000) + 86400 } as any;
    const noExpiry = { expiresAt: null } as any;

    expect(component.isExpired(expired)).toBe(true);
    expect(component.isExpired(notExpired)).toBe(false);
    expect(component.isExpired(noExpiry)).toBe(false);
  });

  it('runs a debounced dose-check once patient and medication are set', fakeAsync(() => {
    const doseCheckResult = {
      guidance: {
        weightBased: {
          guidelineId: 'g1', source: 'AAP', mgPerKg: 15, computedMg: 217.5,
          maxMgPerDose: 1000, maxMgPerDay: 4000, minIntervalHours: 4,
          weightKgUsed: 14.5, weightRecordedAt: 1700000000,
        },
        ageBand: null,
      },
      nextAllowedAt: 1700014400,
      dailyTotalMg: 217.5,
      advisories: [],
    };
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(of(doseCheckResult));

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.form.patchValue({ patientId: 'p1', medicationId: 'med-1' });
    tick(400);

    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/dose-checks',
      expect.objectContaining({ medicationId: 'med-1' }),
    );
    expect(component.doseCheckResult()).toEqual(doseCheckResult);
  }));

  it('clears the dose-check result when the medication is cleared', fakeAsync(() => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(of({ guidance: { weightBased: null, ageBand: null }, nextAllowedAt: null, dailyTotalMg: 0, advisories: [] }));

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.form.patchValue({ patientId: 'p1', medicationId: 'med-1' });
    tick(400);
    expect(component.doseCheckResult()).not.toBeNull();

    component.form.patchValue({ medicationId: '' });
    tick(400);
    expect(component.doseCheckResult()).toBeNull();
  }));

  it('useWeightBasedAmount fills amountMg and amountMl and sets doseSource', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.doseCheckResult.set({
      guidance: {
        weightBased: {
          guidelineId: 'g1', source: 'AAP', mgPerKg: 15, computedMg: 217.456,
          computedMl: 5.4, concentrationMgPerMl: 40,
          maxMgPerDose: 1000, maxMgPerDay: 4000, minIntervalHours: 4,
          weightKgUsed: 14.5, weightRecordedAt: null,
        },
        ageBand: null,
      },
      nextAllowedAt: null,
      dailyTotalMg: 0,
      advisories: [],
    });

    component.useWeightBasedAmount();
    expect(component.form.getRawValue().amountMg).toBe(217.46);
    // The mL the engine derived, so the caregiver holding a syringe doesn't divide by the
    // concentration themselves. This path used to fill only the mg field.
    expect(component.form.getRawValue().amountMl).toBe(5.4);
    expect(component.form.getRawValue().doseSource).toBe('weight_based');
  });

  it('useAgeBandAmount fills amountMg/amountMl/pillCount and sets doseSource', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.doseCheckResult.set({
      guidance: {
        weightBased: null,
        ageBand: {
          guidelineId: 'g2', source: 'Label', doseMg: 160, doseMl: 5,
          doseMlSource: 'guideline', concentrationMgPerMl: 32,
          pillCount: null, frequencyPerDay: 4, maxMgPerDay: 800,
          ageMonthsUsed: 18, applicable: true,
        },
      },
      nextAllowedAt: null,
      dailyTotalMg: 0,
      advisories: [],
    });

    component.useAgeBandAmount();
    const val = component.form.getRawValue();
    expect(val.amountMg).toBe(160);
    expect(val.amountMl).toBe(5);
    expect(val.doseSource).toBe('age_based');
  });

  it('hasStaleWeightAdvisory reflects the current dose-check result', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.hasStaleWeightAdvisory()).toBe(false);
    component.doseCheckResult.set({
      guidance: { weightBased: null, ageBand: null },
      nextAllowedAt: null,
      dailyTotalMg: 0,
      advisories: [{ type: 'stale_weight', severity: 'warning', payload: { daysSince: 75, lastRecordedAt: 1 } }],
    });
    expect(component.hasStaleWeightAdvisory()).toBe(true);
  });

  it('saveQuickWeight logs a weight observation and re-runs the dose check', fakeAsync(() => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockImplementation((path: string) => {
      if (path.includes('/observations')) return of({ id: 'obs-1' });
      return of({ guidance: { weightBased: null, ageBand: null }, nextAllowedAt: null, dailyTotalMg: 0, advisories: [] });
    });

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ patientId: 'p1' });

    component.quickWeightKg.set(14.2);
    component.saveQuickWeight();

    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/observations',
      expect.objectContaining({
        entries: [{ type: 'weight', metadata: { kg: 14.2 } }],
      }),
    );
    expect(component.quickWeightKg()).toBeNull();
    expect(component.savingWeight()).toBe(false);
  }));

  it('shows an error and clears the spinner when logging a quick weight fails', () => {
    // This save used to fail completely silently — no message, no cleared spinner.
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'boom' } })));

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ patientId: 'p1' });
    component.quickWeightKg.set(14.2);
    component.saveQuickWeight();

    expect(component.weightError()).toBe('Could not log the weight.');
    expect(component.savingWeight()).toBe(false);
  });

  it('shows the danger interstitial for a reaction_danger candidate and hides it once acknowledged', fakeAsync(() => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(
      of({
        guidance: { weightBased: null, ageBand: null },
        nextAllowedAt: null,
        dailyTotalMg: 0,
        advisories: [
          { type: 'reaction_danger', severity: 'danger', payload: { description: 'throat swelled up' } },
          { type: 'stale_weight', severity: 'warning', payload: { daysSince: 75, lastRecordedAt: 1 } },
        ],
      }),
    );

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.form.patchValue({ patientId: 'p1', medicationId: 'med-1' });
    tick(400);

    expect(component.showDangerInterstitial()).toBe(true);
    expect(component.dangerAdvisories().length).toBe(1);
    expect(component.nonDangerAdvisories().length).toBe(1);
    expect(component.nonDangerAdvisories()[0].type).toBe('stale_weight');

    component.acknowledgeDangerAdvisories();
    expect(component.showDangerInterstitial()).toBe(false);
  }));

  it('backing out of the danger interstitial clears the selected medication', fakeAsync(() => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(
      of({
        guidance: { weightBased: null, ageBand: null },
        nextAllowedAt: null,
        dailyTotalMg: 0,
        advisories: [{ type: 'reaction_danger', severity: 'danger', payload: {} }],
      }),
    );

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.form.patchValue({ patientId: 'p1', medicationId: 'med-1' });
    tick(400);
    expect(component.showDangerInterstitial()).toBe(true);

    component.clearMedication();
    expect(component.form.getRawValue().medicationId).toBe('');
    expect(component.doseCheckResult()).toBeNull();
    expect(component.showDangerInterstitial()).toBe(false);
  }));

  it('prefills patient, dose, and medication from a scheduleId query param', () => {
    scheduleIdParam = 'sched-1';
    const schedule = {
      id: 'sched-1',
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      medicationEmbodimentId: 'emb-1',
      episodeId: null,
      label: 'Amoxicillin q8h',
      doseMg: 400,
      doseMl: null,
      pillCount: null,
      bodyLocation: null,
      side: null,
      dressingType: null,
      frequencyHours: 8,
      explicitTimes: null,
      startAt: 1700000000,
      endAfterOccurrences: null,
      endAt: null,
      notes: null,
      status: 'active',
      nextDueAt: 1700028800,
      createdByUserId: 'u1',
      createdAt: 1700000000,
      updatedAt: 1700000000,
      adherence: { expectedCount: 1, loggedCount: 0, missed: 0, remainingOccurrences: null, overdue: false },
    };
    const medication = {
      id: 'med-1',
      name: 'Amoxicillin',
      brandNames: [],
      description: null,
      tags: [],
      defaultActive: true,
      createdAt: 0,
      updatedAt: 0,
    };
    const embodiments = [
      {
        id: 'emb-1',
        medicationId: 'med-1',
        label: '400mg/5mL suspension',
        concentrationMgPerMl: 80,
        strengthMgPerUnit: null,
        unitType: 'ml',
        notes: null,
        atHome: true,
        expiresAt: null,
        runningLow: false,
        runningLowFlaggedByUserId: null,
        runningLowFlaggedAt: null,
      },
    ];

    apiMock.get.mockImplementation((path: string) => {
      if (path === '/schedules/sched-1') return of(schedule);
      if (path === '/medications/med-1') return of(medication);
      if (path === '/medications/med-1/embodiments') return of(embodiments);
      if (path.includes('/episodes')) return of([]);
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });

    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const val = component.form.getRawValue();
    expect(val.patientId).toBe('p1');
    expect(val.interventionScheduleId).toBe('sched-1');
    expect(val.doseSource).toBe('override');
    expect(val.amountMg).toBe(400);
    expect(val.medicationId).toBe('med-1');
    expect(val.medicationEmbodimentId).toBe('emb-1');
    expect(component.selectedMedication()?.id).toBe('med-1');
    expect(component.embodiments().length).toBe(1);
  });
});
