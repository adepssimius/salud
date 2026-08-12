import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AnalyteDetailPage } from './analyte-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const ANALYTE = {
  id: 'a1',
  name: 'FERRITIN',
  displayName: 'Ferritin',
  unit: 'ng/mL',
  panel: 'IRON AND TOTAL IRON BINDING CAPACITY',
  createdAt: 1700000000,
  updatedAt: 1700000000,
};

const day = 86400;
const RANGES = [
  { id: 'r2', analyteId: 'a1', refLow: 38, refHigh: 380, refText: null, effectiveFrom: 1700000000, source: 'Quest report', createdAt: 0, updatedAt: 0 },
  { id: 'r1', analyteId: 'a1', refLow: 30, refHigh: 400, refText: null, effectiveFrom: 1600000000, source: 'Older standard', createdAt: 0, updatedAt: 0 },
];

const HISTORY = {
  analyte: ANALYTE,
  ranges: [RANGES[1], RANGES[0]], // ascending, as the API returns them
  goal: { id: 'g1', patientId: 'p1', analyteId: 'a1', goalLow: 120, goalHigh: null, note: 'athletic', createdAt: 0, updatedAt: 0 },
  // One result drawn under the older standard, one after the revision took effect — so the chart
  // has to step its bands rather than draw one.
  points: [
    { observationId: 'o1', observedAt: 1650000000, valueText: '37', value: 37, unit: 'ng/mL', flag: 'L' },
    { observationId: 'o2', observedAt: 1700000000 + 200 * day, valueText: '95', value: 95, unit: 'ng/mL', flag: null },
  ],
};

describe('AnalyteDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  function routeGets(url: string) {
    if (url === '/analytes/a1') return of(ANALYTE);
    if (url === '/analytes/a1/reference-ranges') return of(RANGES);
    if (url === '/patients') return of([{ id: 'p1', fullName: 'Ben Penkacik' }]);
    if (url === '/patients/p1/analytes/a1/history') return of(HISTORY);
    return of(null);
  }

  beforeEach(async () => {
    apiMock = { get: jest.fn(routeGets), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() };
    routerMock = { navigate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [AnalyteDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'a1']]) } } },
      ],
    }).compileComponents();
  });

  it('shows the analyte with its dated range history, marking the one in effect now', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ferritin');
    expect(text).toContain('FERRITIN'); // what incoming reports match on
    expect(text).toContain('38–380');
    expect(text).toContain('30–400');
    expect(text).toContain('current');
    // The greatest effectiveFrom at or before now wins, exactly as the API resolves it.
    expect(fixture.componentInstance.currentRangeId()).toBe('r2');
  });

  it('loads the goal and history once a patient is picked, and charts against range and goal', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();

    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/analytes/a1/history');
    expect(fixture.componentInstance.goalForm.value.goalLow).toBe(120);
    expect(fixture.componentInstance.plotted().length).toBe(2);
    // One band per range, the older one ending exactly where the revision takes effect.
    const bands = fixture.componentInstance.rangeBands();
    expect(bands.length).toBe(2);
    expect(bands[0].x + bands[0].width).toBeCloseTo(bands[1].x, 5);
    expect(bands[0].label).toContain('30–400');
    expect(bands[1].label).toContain('38–380');
    expect(fixture.componentInstance.goalLines()).toEqual([
      { y: expect.any(Number), label: 'Goal at or above 120' },
    ]);
    // Earlier point sits left of the later one, and the lower value sits below the higher one.
    const [first, second] = fixture.componentInstance.plotted();
    expect(first.x).toBeLessThan(second.x);
    expect(first.y).toBeGreaterThan(second.y);
  });

  it('lists rather than charts when the results are not all in the same unit', () => {
    apiMock.get = jest.fn((url: string) =>
      url === '/patients/p1/analytes/a1/history'
        ? of({
            ...HISTORY,
            points: [
              { observationId: 'o1', observedAt: 1700000000, valueText: '37', value: 37, unit: 'ng/mL', flag: null },
              { observationId: 'o2', observedAt: 1700100000, valueText: '83', value: 83, unit: 'pmol/L', flag: null },
            ],
          })
        : routeGets(url),
    );
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();
    expect(fixture.componentInstance.mixedUnits()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('not all reported in the same unit');
  });

  it('saves a goal for the selected patient', () => {
    apiMock.put.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.componentInstance.goalForm.setValue({ goalLow: 150, goalHigh: null, note: 'raised' });
    fixture.componentInstance.saveGoal();
    expect(apiMock.put).toHaveBeenCalledWith('/patients/p1/analyte-goals/a1', {
      goalLow: 150,
      goalHigh: undefined,
      note: 'raised',
    });
  });

  it('explains an in-use analyte instead of deleting it', () => {
    apiMock.delete.mockReturnValue(throwError(() => ({ error: { message: 'ANALYTE_IN_USE' } })));
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.deleteAnalyte();
    expect(fixture.componentInstance.deleteError()).toContain('recorded lab results');
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('describes open-ended and text-only ranges in words', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    const page = fixture.componentInstance;
    expect(page.describeRange({ refLow: 38, refHigh: 380, refText: null })).toBe('38–380');
    expect(page.describeRange({ refLow: null, refHigh: 90, refText: null })).toBe('at or below 90');
    expect(page.describeRange({ refLow: 120, refHigh: null, refText: null })).toBe('at or above 120');
    expect(page.describeRange({ refLow: null, refHigh: null, refText: 'For 8 a.m. specimens' })).toBe(
      'For 8 a.m. specimens',
    );
  });
});
