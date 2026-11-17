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
  let queryParams: Record<string, string>;

  beforeEach(async () => {
    queryParams = {};
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
      // Keyed, not a single stub value: the page now reads several query params, and a `get` that
      // answered every key with the same string is how a scheduleId ended up being read as a
      // medicationId.
      snapshot: { queryParamMap: { get: (key: string) => queryParams[key] ?? null } },
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

  // The button once read "Save for ⟨name⟩" from a value that did not follow the select, so it could
  // name one patient while the form saved to another (frontend.md → "Patient identity").
  describe('patient select', () => {
    function renderFromPatientPage() {
      queryParams = { patientId: 'p1' };
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/patients') {
          return of([
            { id: 'p1', fullName: 'Isla' },
            { id: 'p2', fullName: 'Sierra' },
          ]);
        }
        return of([]);
      });
      const fixture = TestBed.createComponent(NewInterventionPage);
      fixture.detectChanges();
      return fixture;
    }

    function choosePatient(fixture: ReturnType<typeof renderFromPatientPage>, id: string) {
      const select = (fixture.nativeElement as HTMLElement).querySelector(
        'select[formControlName="patientId"]',
      ) as HTMLSelectElement;
      select.value = id;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('labels the save button plainly, before and after the patient is changed', () => {
      const fixture = renderFromPatientPage();
      const save = () =>
        (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]')?.textContent?.trim();
      expect(save()).toBe('Save');
      choosePatient(fixture, 'p2');
      expect(save()).toBe('Save');
      expect((fixture.nativeElement as HTMLElement).querySelector('.actions')?.textContent).not.toMatch(
        /Isla|Sierra/,
      );
    });

    it('saves to the patient chosen in the select, not the one the form was opened for', () => {
      apiMock.post.mockReturnValue(of({}));
      const fixture = renderFromPatientPage();
      choosePatient(fixture, 'p2');
      fixture.componentInstance.form.patchValue({
        type: 'medication_dose',
        medicationId: 'med-1',
        doseSource: 'override',
        amountMg: 100,
      });
      fixture.componentInstance.submit();
      expect(apiMock.post).toHaveBeenCalledWith('/patients/p2/interventions', expect.anything());
    });
  });

  // frontend.md → Quick Log → "Episode attachment": the full dose form shows the start control
  // without opening anything, the same as the full observation form.
  for (const [label, episodes] of [
    ['no active episode', []],
    ['one active episode', [{ id: 'ep1', name: 'Fever' }]],
  ] as const) {
    it(`shows "Start a new episode" with no More to open on the full form — ${label}`, () => {
      queryParams = { patientId: 'p1' };
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/episodes')) return of([...episodes]);
        return of([{ id: 'p1', fullName: 'Kiddo' }]);
      });
      const fixture = TestBed.createComponent(NewInterventionPage);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Start a new episode');
      expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent!.trim() === 'More')).toBe(false);
    });
  }

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

  it('fills mg from mL and leaves amountMg for the server to derive, in the preview and the save', fakeAsync(() => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments')) {
        return of([{ id: 'emb-1', label: 'Infant 160 mg/5 mL', concentrationMgPerMl: 32, strengthMgPerUnit: null, unitType: 'ml' }]);
      }
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });
    apiMock.post.mockReturnValue(of({ guidance: { weightBased: null, ageBand: null }, advisories: [], dailyTotalMg: 0 }));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ patientId: 'p1' });
    component.selectMedication({ id: 'med-1', name: 'acetaminophen' } as any);
    component.form.controls.medicationEmbodimentId.setValue('emb-1');
    component.form.controls.amountMl.setValue(10);
    expect(component.form.getRawValue().amountMg).toBe(320);

    tick(400);
    const preview = apiMock.post.mock.calls.filter(([path]: [string]) => path.endsWith('/dose-checks')).pop();
    expect(preview[1]).toMatchObject({ amountMl: 10 });
    expect(preview[1].amountMg).toBeUndefined();

    component.submit();
    const saved = apiMock.post.mock.calls.find(([path]: [string]) => path.endsWith('/interventions'));
    expect(saved[1]).toMatchObject({ amountMl: 10, medicationEmbodimentId: 'emb-1' });
    expect(saved[1].amountMg).toBeUndefined();
  }));

  describe('amount boxes by embodiment (frontend.md → "The embodiment decides which amount boxes show")', () => {
    const kinds = [
      { id: 'liquid', label: 'Infant 160 mg/5 mL', concentrationMgPerMl: 32, strengthMgPerUnit: null, unitType: 'ml' },
      { id: 'tablet', label: '80 mg chewable', concentrationMgPerMl: null, strengthMgPerUnit: 80, unitType: 'tablet' },
      { id: 'capsule', label: '200 mg capsule', concentrationMgPerMl: null, strengthMgPerUnit: 200, unitType: 'capsule' },
      { id: 'drop', label: 'Eye drops', concentrationMgPerMl: null, strengthMgPerUnit: 0.5, unitType: 'drop' },
      { id: 'cream', label: '1% cream', concentrationMgPerMl: null, strengthMgPerUnit: null, unitType: 'other', dosageForm: 'cream' },
      { id: 'chewable', label: '80 mg chewable', concentrationMgPerMl: null, strengthMgPerUnit: 80, unitType: 'tablet', dosageForm: 'chewable' },
      { id: 'untyped', label: 'Something else', concentrationMgPerMl: null, strengthMgPerUnit: null, unitType: 'other', dosageForm: null },
    ];

    function renderWithKinds() {
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/embodiments')) return of(kinds);
        return of([{ id: 'p1', fullName: 'Patient 1' }]);
      });
      apiMock.post.mockReturnValue(of({ guidance: { weightBased: null, ageBand: null }, advisories: [], dailyTotalMg: 0 }));
      const fixture = TestBed.createComponent(NewInterventionPage);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      component.form.patchValue({ patientId: 'p1', type: 'medication_dose' });
      component.selectMedication({ id: 'med-1', name: 'acetaminophen', brandNames: [] } as any);
      fixture.detectChanges();
      return { fixture, component, el: fixture.nativeElement as HTMLElement };
    }

    function boxes(fixture: any) {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      return {
        mg: !!el.querySelector('input[formControlName="amountMg"]'),
        ml: !!el.querySelector('input[formControlName="amountMl"]'),
        count: el.querySelector('#pill-count-label')?.textContent?.trim() ?? null,
        fractions: !!el.querySelector('app-pill-count-input select'),
      };
    }

    function pick(component: NewInterventionPage, id: string) {
      component.form.controls.medicationEmbodimentId.setValue(id);
    }

    it('shows mg alone until an embodiment is chosen', () => {
      const { fixture } = renderWithKinds();
      expect(boxes(fixture)).toEqual({ mg: true, ml: false, count: null, fractions: false });
    });

    it.each([
      ['liquid', { mg: true, ml: true, count: null, fractions: false }],
      ['tablet', { mg: true, ml: false, count: 'Tablets', fractions: true }],
      ['capsule', { mg: true, ml: false, count: 'Capsules', fractions: true }],
      ['drop', { mg: true, ml: false, count: 'Drops', fractions: false }],
      ['chewable', { mg: true, ml: false, count: 'Chewables', fractions: true }],
      ['cream', { mg: false, ml: false, count: null, fractions: false }],
      ['untyped', { mg: true, ml: false, count: null, fractions: false }],
    ])('a %s embodiment shows %o', (id, expected) => {
      const { fixture, component } = renderWithKinds();
      pick(component, id);
      expect(boxes(fixture)).toEqual(expected);
    });

    it('switching liquid → tablet empties the mL, so the save carries mg and tablets only', () => {
      const { fixture, component } = renderWithKinds();
      pick(component, 'liquid');
      component.form.controls.amountMl.setValue(5);
      expect(component.form.getRawValue().amountMg).toBe(160);
      pick(component, 'tablet');
      expect(boxes(fixture)).toMatchObject({ ml: false, count: 'Tablets' });
      expect(component.form.getRawValue()).toMatchObject({ amountMl: null, amountMg: 160, pillCount: 2 });

      apiMock.post.mockReturnValue(of({}));
      component.submit();
      const saved = apiMock.post.mock.calls.find(([path]: [string]) => path.endsWith('/interventions'));
      expect(saved[1]).toMatchObject({ amountMg: 160, pillCount: 2, medicationEmbodimentId: 'tablet' });
      expect(saved[1].amountMl).toBeUndefined();
    });

    it('a cream shows no amount at all and saves the dose with none', () => {
      const { fixture, component, el } = renderWithKinds();
      pick(component, 'tablet');
      component.form.controls.pillCount.setValue(2);
      pick(component, 'cream');
      expect(boxes(fixture)).toEqual({ mg: false, ml: false, count: null, fractions: false });
      expect(component.form.getRawValue()).toMatchObject({ amountMg: null, amountMl: null, pillCount: null });
      expect(el.querySelector('.no-amount')?.textContent).toContain('No amount to measure');

      apiMock.post.mockReturnValue(of({}));
      component.submit();
      const saved = apiMock.post.mock.calls.find(([path]: [string]) => path.endsWith('/interventions'));
      expect(saved[1]).toMatchObject({ medicationEmbodimentId: 'cream' });
      expect(saved[1].amountMg).toBeUndefined();
      expect(saved[1].amountMl).toBeUndefined();
      expect(saved[1].pillCount).toBeUndefined();
    });

    it('switching from a cream back to a tablet brings mg back, empty', () => {
      const { fixture, component } = renderWithKinds();
      pick(component, 'cream');
      pick(component, 'tablet');
      expect(boxes(fixture)).toMatchObject({ mg: true, count: 'Tablets' });
    });

    it('keeps a box that holds a value visible even when the kind would hide it', () => {
      const { fixture, component } = renderWithKinds();
      // A prefilled volume with no bottle chosen yet is shown, not hidden and silently sent.
      component.form.controls.amountMl.setValue(5);
      expect(boxes(fixture)).toMatchObject({ ml: true, count: null });
    });
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
    expect(apiMock.get).toHaveBeenCalledWith('/medications', { q: 'tylenol', activeOnly: true });
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
    // Only a correction excludes a dose from its own preview; create sends no such key at all.
    const [, createBody] = apiMock.post.mock.calls.find(([path]: [string]) => path.endsWith('/dose-checks'));
    expect('excludeInterventionId' in createBody).toBe(false);
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
    queryParams = { scheduleId: 'sched-1' };
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
      timeZone: null,
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
  // frontend.md → Schedules → "Missed doses": logging a missed dose from its schedule repeats the
  // instruction, and Home's "Log double dose" arrives with the prescribed double ticked.
  it('shows the missed-dose instruction and prefills the prescribed double, sending it as such', () => {
    queryParams = { scheduleId: 'sched-2', double: '1' };
    const schedule = {
      id: 'sched-2',
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      medicationEmbodimentId: null,
      episodeId: null,
      label: 'Amoxicillin q8h',
      doseMg: 400,
      doseMl: null,
      pillCount: null,
      frequencyHours: 8,
      explicitTimes: null,
      startAt: 1700000000,
      status: 'active',
      missedDoseAction: 'double_next',
      missedDose: { slotAt: 1700000000, nextSlotAt: 1700028800, action: 'double_next', pastCutoff: false, doubleNextDue: true },
      adherence: { expectedCount: 1, loggedCount: 0, skippedCount: 0, missed: 1, remainingOccurrences: null, overdue: true },
    };
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/schedules/sched-2') return of(schedule);
      if (path === '/medications/med-1') return of({ id: 'med-1', name: 'Amoxicillin', brandNames: [], tags: [] });
      if (path === '/medications/med-1/embodiments') return of([]);
      if (path.includes('/episodes')) return of([]);
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });
    apiMock.post.mockReturnValue(of({ id: 'i1' }));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.querySelector('.missed-dose').textContent).toContain("Don't give it now — give a double dose at the next dose");
    expect(component.prescribedDouble()).toBe(true);
    expect(component.form.getRawValue().amountMg).toBe(800);

    // The preview's atypical warning says why the dose is over the maximum.
    component.doseCheckResult.set({
      guidance: { weightBased: null, ageBand: null },
      nextAllowedAt: null,
      dailyTotalMg: 800,
      advisories: [{ type: 'atypical_dose', severity: 'warning', payload: { reasons: ['exceeds_max_per_dose'] } }],
    } as any);
    expect(component.nonDangerAdvisories()[0].payload).toMatchObject({ prescribedDouble: true });

    component.setPrescribedDouble(false);
    expect(component.form.getRawValue().amountMg).toBe(400);
    component.setPrescribedDouble(true);
    component.form.patchValue({ performedAt: '2026-01-01T08:00' });
    component.submit();
    const body = apiMock.post.mock.calls.find((c: any[]) => String(c[0]).endsWith('/interventions'))![1];
    expect(body).toMatchObject({ interventionScheduleId: 'sched-2', prescribedDouble: true, amountMg: 800 });
  });

  // frontend.md → "Information architecture (v2)" → Quick Log: "Dose: recents first, search
  // second." The sheet picks the medication; this form takes the prefill and does everything else
  // exactly as it always did.
  describe('quick-log handoff', () => {
    const medication = {
      id: 'med-1',
      name: 'Acetaminophen',
      brandNames: ['Tylenol'],
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
        label: 'infant suspension 160mg/5mL',
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
    ];

    function render(params: Record<string, string>, episodes: Array<{ id: string; name: string }> = []) {
      queryParams = params;
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/medications/med-1') return of(medication);
        if (path === '/medications/med-1/embodiments') return of(embodiments);
        if (path.includes('/episodes')) return of(episodes);
        return of([{ id: 'p1', fullName: 'Kiddo' }]);
      });
      apiMock.post.mockReturnValue(
        of({ guidance: { weightBased: null, ageBand: null }, nextAllowedAt: null, dailyTotalMg: 0, advisories: [] }),
      );
      const fixture = TestBed.createComponent(NewInterventionPage);
      fixture.detectChanges();
      return fixture;
    }

    const repeatDose = {
      patientId: 'p1',
      type: 'medication_dose',
      compact: '1',
      medicationId: 'med-1',
      embodimentId: 'emb-1',
      amountMg: '160',
      amountMl: '5',
    };

    it('prefills medication, embodiment and amount from "same as last time"', () => {
      const fixture = render(repeatDose);
      const val = fixture.componentInstance.form.getRawValue();

      expect(val.patientId).toBe('p1');
      expect(val.medicationId).toBe('med-1');
      expect(val.medicationEmbodimentId).toBe('emb-1');
      expect(val.amountMg).toBe(160);
      expect(val.amountMl).toBe(5);
      expect(fixture.componentInstance.selectedMedication()?.id).toBe('med-1');
    });

    // The source travels with the amount, or every repeat of a guideline dose gets recorded as an
    // ad-hoc override and flagged atypical for it (frontend.md → Home).
    describe('dose source', () => {
      it('carries the previous source rather than leaving the form on its override default', () => {
        const fixture = render({ ...repeatDose, doseSource: 'weight_based' });
        expect(fixture.componentInstance.form.getRawValue().doseSource).toBe('weight_based');
      });

      it('degrades schedule to override — a repeat is not executing the standing schedule', () => {
        const fixture = render({ ...repeatDose, doseSource: 'schedule' });
        const val = fixture.componentInstance.form.getRawValue();
        expect(val.doseSource).toBe('override');
        expect(val.interventionScheduleId).toBe('');
      });

      it('keeps the override default for an absent or bogus source', () => {
        expect(render(repeatDose).componentInstance.form.getRawValue().doseSource).toBe('override');
        expect(
          render({ ...repeatDose, doseSource: 'vibes' }).componentInstance.form.getRawValue().doseSource,
        ).toBe('override');
      });
    });

    it('the compact quick-log shows only the boxes its embodiment fits', () => {
      const fixture = render(repeatDose);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('input[formControlName="amountMg"]')).not.toBeNull();
      expect(el.querySelector('input[formControlName="amountMl"]')).not.toBeNull();
      expect(el.querySelector('app-pill-count-input')).toBeNull();
    });

    // The quick tiles stay minimal: the episode options stay behind More there.
    it('keeps "Start a new episode" behind More on the compact dose form', () => {
      const el = render(repeatDose).nativeElement as HTMLElement;
      expect(el.textContent).not.toContain('Start a new episode');
      expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent!.trim() === 'More')).toBe(true);
    });

    it('renders the compact layout with the patient pinned and no patient or type picker', () => {
      const fixture = render(repeatDose);
      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelector('h1')?.textContent).toContain('Log dose');
      expect(el.querySelector('.for-patient-name')?.textContent).toContain('Kiddo');
      expect(el.querySelector('select[formControlName="patientId"]')).toBeNull();
      expect(el.querySelector('select[formControlName="type"]')).toBeNull();
    });

    // The pinned "For Kiddo" line names the patient; the button does not repeat it.
    it('labels the save button plainly, with no patient name', () => {
      const fixture = render(repeatDose);
      const save = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]');
      expect(save?.textContent?.trim()).toBe('Save');
    });

    // The prefill fills fields; it does not skip a single guardrail (P1).
    it('still runs the dose check on the prefilled values', fakeAsync(() => {
      const fixture = render(repeatDose);
      tick(400);
      expect(apiMock.post).toHaveBeenCalledWith(
        '/patients/p1/dose-checks',
        expect.objectContaining({ medicationId: 'med-1', medicationEmbodimentId: 'emb-1', amountMg: 160 }),
      );
      fixture.destroy();
    }));

    it('still raises the danger interstitial on a prefilled repeat dose', fakeAsync(() => {
      queryParams = repeatDose;
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/medications/med-1') return of(medication);
        if (path === '/medications/med-1/embodiments') return of(embodiments);
        if (path.includes('/episodes')) return of([]);
        return of([{ id: 'p1', fullName: 'Kiddo' }]);
      });
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
      tick(400);
      expect(fixture.componentInstance.showDangerInterstitial()).toBe(true);
      fixture.destroy();
    }));

    it('pre-attaches a single active episode and pre-selects nothing when there are two', () => {
      const one = render(repeatDose, [{ id: 'ep1', name: 'Fever – Aug 2026' }]);
      expect(one.componentInstance.selectedEpisodeIds()).toEqual(['ep1']);
      expect((one.nativeElement as HTMLElement).textContent).toContain('Adding to');

      const two = render(repeatDose, [
        { id: 'ep1', name: 'Fever' },
        { id: 'ep2', name: 'Ear infection' },
      ]);
      expect(two.componentInstance.selectedEpisodeIds()).toEqual([]);
    });
  });
});
