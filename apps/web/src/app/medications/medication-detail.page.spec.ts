import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MedicationDetailPage } from './medication-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('MedicationDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.includes('/embodiments') || path.includes('/guidelines')) return of([]);
        return of({
          id: 'm1',
          name: 'acetaminophen',
          brandNames: [],
          description: null,
          tags: [],
          defaultActive: true,
          createdAt: 0,
          updatedAt: 0,
        });
      }),
      post: jest.fn(),
      patch: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [MedicationDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'm1']]) } },
        },
      ],
    }).compileComponents();
  });

  it('loads medication, embodiments, and guidelines on init', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments')) {
        return of([
          {
            id: 'e1',
            medicationId: 'm1',
            label: '500mg tablet',
            concentrationMgPerMl: null,
            strengthMgPerUnit: 500,
            unitType: 'tablet',
            notes: null,
            atHome: false,
            expiresAt: null,
            runningLow: false,
            runningLowFlaggedByUserId: null,
            runningLowFlaggedAt: null,
          },
        ]);
      }
      if (path.includes('/guidelines')) {
        return of([]);
      }
      return of({ id: 'm1', name: 'acetaminophen', brandNames: [], description: null, tags: [], defaultActive: true, createdAt: 0, updatedAt: 0 });
    });

    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.medication()?.name).toBe('acetaminophen');
    expect(comp.embodiments().length).toBe(1);
  });

  it('toggles runningLow via PATCH', () => {
    apiMock.patch.mockReturnValue(of({ id: 'e1', runningLow: true }));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const embodiment = {
      id: 'e1',
      medicationId: 'm1',
      label: 'x',
      concentrationMgPerMl: null,
      concentrationMg: null,
      concentrationVolumeMl: null,
      strengthMgPerUnit: null,
      unitType: 'tablet' as const,
      notes: null,
      atHome: false,
      expiresAt: null,
      runningLow: false,
      runningLowFlaggedByUserId: null,
      runningLowFlaggedAt: null,
    };
    comp.toggleRunningLow(embodiment, { target: { checked: true } } as unknown as Event);
    expect(apiMock.patch).toHaveBeenCalledWith('/embodiments/e1', { runningLow: true });
  });

  // The point of the pair: the form posts what the bottle prints, and the server does the
  // division. A UI that divided here would just move the arithmetic error to the client.
  it('creates an embodiment posting the printed concentration pair', () => {
    apiMock.post.mockReturnValue(of({ id: 'e2' }));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.embodimentForm.setValue({
      label: '5mL syrup',
      unitType: 'ml',
      concentrationMg: 160,
      concentrationVolumeMl: 5,
      strengthMgPerUnit: null,
    });
    expect(comp.derivedConcentration()).toBe(32);
    comp.createEmbodiment();
    expect(apiMock.post).toHaveBeenCalledWith('/medications/m1/embodiments', {
      label: '5mL syrup',
      unitType: 'ml',
      concentrationMg: 160,
      concentrationVolumeMl: 5,
      strengthMgPerUnit: undefined,
    });
  });

  it('omits the concentration entirely for a solid form, rather than sending a bare 1 mL', () => {
    apiMock.post.mockReturnValue(of({ id: 'e3' }));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    // The volume box defaults to 1; a tablet leaves the mg box empty, and "per 1 mL" alone means
    // nothing -- sending it would 400 with CONCENTRATION_PAIR_INCOMPLETE.
    comp.embodimentForm.setValue({
      label: '500 mg tablet',
      unitType: 'tablet',
      concentrationMg: null,
      concentrationVolumeMl: 1,
      strengthMgPerUnit: 500,
    });
    comp.createEmbodiment();
    expect(apiMock.post).toHaveBeenCalledWith('/medications/m1/embodiments', {
      label: '500 mg tablet',
      unitType: 'tablet',
      concentrationMg: undefined,
      concentrationVolumeMl: undefined,
      strengthMgPerUnit: 500,
    });
  });

  it('does not flag the untouched form, where the volume box is pre-filled with 1', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    // Regression: a symmetric "exactly one filled" check made the *starting* state incomplete
    // (no mg, 1 mL), which disabled Add for every tablet.
    expect(comp.concentrationPairIncomplete()).toBe(false);
    expect(comp.embodimentForm.getRawValue().concentrationVolumeMl).toBe(1);
  });

  it('flags a half-filled concentration pair before it can be submitted', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.embodimentForm.setValue({
      label: 'syrup',
      unitType: 'ml',
      concentrationMg: 160,
      concentrationVolumeMl: null,
      strengthMgPerUnit: null,
    });
    expect(comp.concentrationPairIncomplete()).toBe(true);
    expect(comp.derivedConcentration()).toBeNull();
  });

  it('navigates back to the medications list', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.backToList();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/medications']);
  });
  it('swaps the guideline fields when the type changes', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    // Regression test for a frozen computed(): reading a form control's plain `.value` inside
    // computed() registers no signal dependency, so isWeightBased() evaluated once and cached
    // true forever -- the age-band form was unreachable through the UI.
    expect(comp.isWeightBased()).toBe(true);
    comp.guidelineForm.controls.type.setValue('age_band');
    expect(comp.isWeightBased()).toBe(false);
  });

  it('requires maxMgPerDay for both types, and the per-type fields', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.guidelineForm.patchValue({ source: 'AAP', type: 'weight_based', mgPerKg: 15, maxMgPerDose: 1000, minIntervalHours: 4 });
    // maxMgPerDay still blank -- it is required server-side for both types and had no validator
    // here at all, so the form submitted, 400'd, and nothing visible happened.
    expect(comp.guidelineForm.invalid).toBe(true);
    comp.guidelineForm.patchValue({ maxMgPerDay: 4000 });
    expect(comp.guidelineForm.valid).toBe(true);

    comp.guidelineForm.controls.type.setValue('age_band');
    // The weight-based fields stop being required; the age-band ones start.
    expect(comp.guidelineForm.invalid).toBe(true);
    comp.guidelineForm.patchValue({ ageMinMonths: 24, ageMaxMonths: 72, doseMg: 160, frequencyPerDay: 4 });
    expect(comp.guidelineForm.valid).toBe(true);
  });

  it('shows an error instead of a blank page when the medication fails to load', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments') || path.includes('/guidelines')) return of([]);
      return throwError(() => ({ status: 500, error: { message: 'boom' } }));
    });

    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.medication()).toBeNull();
    expect(comp.loadError()).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Loading…');
  });

  it('rolls the checkbox back and says so when the cabinet PATCH fails', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments')) {
        return of([{ id: 'e1', medicationId: 'm1', label: 'x', unitType: 'tablet', atHome: false, runningLow: false }]);
      }
      if (path.includes('/guidelines')) return of([]);
      return of({ id: 'm1', name: 'acetaminophen', brandNames: [], description: null, tags: [], defaultActive: true, createdAt: 0, updatedAt: 0 });
    });
    apiMock.patch.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'boom' } })));

    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.toggleRunningLow(comp.embodiments()[0], { target: { checked: true } } as unknown as Event);

    // A failed PATCH used to leave the box checked while the server disagreed -- on runningLow
    // that means the shopping list silently disagrees with the screen.
    expect(comp.embodiments()[0].runningLow).toBe(false);
    expect(comp.cabinetError()).toBeTruthy();
  });

  it('reports a failed guideline create instead of doing nothing', () => {
    apiMock.post.mockReturnValue(throwError(() => ({ status: 400, error: { message: ['maxMgPerDay must be a number'] } })));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.guidelineForm.patchValue({
      source: 'AAP',
      type: 'weight_based',
      mgPerKg: 15,
      maxMgPerDose: 1000,
      minIntervalHours: 4,
      maxMgPerDay: 4000,
    });
    comp.createGuideline();

    expect(comp.guidelineError()).toBeTruthy();
    expect(comp.guidelineSaving()).toBe(false);
    expect(comp.showGuidelineForm()).toBe(false);
  });
});
