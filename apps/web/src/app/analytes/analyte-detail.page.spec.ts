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
const range = (over: Record<string, unknown>) => ({
  analyteId: 'a1',
  patientId: 'p1',
  kind: 'reference',
  label: 'Reference',
  low: null,
  high: null,
  refText: null,
  source: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// Two lineages: the lab's reference (revised once) and the caregiver's own one-sided target.
const REFERENCE_OLD = range({ id: 'r1', low: 30, high: 400, effectiveFrom: 1600000000, source: 'Older standard' });
const REFERENCE_NEW = range({ id: 'r2', low: 38, high: 380, effectiveFrom: 1700000000, source: 'Quest report' });
const ATHLETIC_GOAL = range({ id: 'r3', kind: 'custom', label: 'Athletic goal', low: 120, effectiveFrom: 1600000000 });

const RANGES = [REFERENCE_NEW, ATHLETIC_GOAL, REFERENCE_OLD]; // newest first, as the API returns

const HISTORY = {
  analyte: ANALYTE,
  ranges: [REFERENCE_OLD, ATHLETIC_GOAL, REFERENCE_NEW], // ascending, as the API returns them
  // One result drawn under the older standard, one after the revision took effect — so the chart
  // has to step the reference bands rather than draw one.
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
    if (url === '/patients/p1/analytes/a1/ranges') return of(RANGES);
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

  it('shows the analyte, and asks for a patient before any range', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ferritin');
    expect(text).toContain('FERRITIN'); // what incoming reports match on
    // Ranges belong to a patient, so nothing is fetched or shown until one is chosen.
    expect(apiMock.get).not.toHaveBeenCalledWith('/patients/p1/analytes/a1/ranges');
    expect(text).toContain('depends on who was measured');
  });

  it('groups a patient\'s ranges into lineages, marking the row in effect within each', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();

    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/analytes/a1/ranges');
    const lineages = fixture.componentInstance.lineages();
    expect(lineages.map((l: any) => l.label)).toEqual(['Reference', 'Athletic goal']); // reference first
    // Each lineage resolves its own current row — a newer reference doesn't unseat the goal.
    expect(lineages[0].rows.map((r: any) => r.id)).toEqual(['r2', 'r1']); // newest first within
    expect(lineages[0].currentId).toBe('r2');
    expect(lineages[1].currentId).toBe('r3');

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('38–380');
    expect(text).toContain('30–400');
    expect(text).toContain('Athletic goal');
    expect(text).toContain('at or above 120');
  });

  it('charts one band per row, clipped within its own lineage', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();

    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/analytes/a1/history');
    expect(fixture.componentInstance.plotted().length).toBe(2);

    const bands = fixture.componentInstance.rangeBands();
    expect(bands.length).toBe(3); // two reference eras + the goal
    const reference = bands.filter((b: any) => b.reference);
    // The older reference ends exactly where the revision takes effect.
    expect(reference[0].x + reference[0].width).toBeCloseTo(reference[1].x, 5);
    expect(reference[0].label).toContain('30–400');
    expect(reference[1].label).toContain('38–380');
    // The goal spans the whole chart — a new reference range doesn't end it.
    const goalBand = bands.find((b: any) => !b.reference);
    expect(goalBand.label).toBe('Athletic goal at or above 120');
    expect(goalBand.width).toBeCloseTo(fixture.componentInstance.chartWidth, 5);

    // Earlier point sits left of the later one, and the lower value sits below the higher one.
    const [first, second] = fixture.componentInstance.plotted();
    expect(first.x).toBeLessThan(second.x);
    expect(first.y).toBeGreaterThan(second.y);
  });

  it('scales the chart to include a bound no result has reached', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();
    // Values top out at 95; the 120 goal and the 400 reference must still be on the canvas, or a
    // caregiver would see a goal line that isn't there.
    for (const band of fixture.componentInstance.rangeBands()) {
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.y + band.height).toBeLessThanOrEqual(fixture.componentInstance.chartHeight);
    }
  });

  it('reloads ranges and history together when the patient changes', () => {
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.detectChanges();
    expect(fixture.componentInstance.ranges().length).toBe(3);

    // Clearing the patient clears both — one person's standards must never render under another.
    fixture.componentInstance.selectPatient(null);
    fixture.detectChanges();
    expect(fixture.componentInstance.ranges()).toEqual([]);
    expect(fixture.componentInstance.history()).toBeNull();
  });

  it('adds a named range for the selected patient, custom unless marked as the lab reference', () => {
    apiMock.post.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(AnalyteDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.selectPatient('p1');
    fixture.componentInstance.rangeForm.setValue({
      label: 'Optimal',
      low: 30,
      high: null,
      refText: '',
      effectiveFrom: '2026-07-20',
      source: 'lab handout',
      isReference: false,
    });
    fixture.componentInstance.addRange();

    const [path, body] = apiMock.post.mock.calls[0];
    expect(path).toBe('/patients/p1/analytes/a1/ranges');
    expect(body).toMatchObject({ label: 'Optimal', kind: 'custom', low: 30, high: undefined, source: 'lab handout' });
    expect(body.effectiveFrom).toEqual(expect.any(String));
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
    expect(page.describeRange({ low: 38, high: 380, refText: null })).toBe('38–380');
    expect(page.describeRange({ low: null, high: 90, refText: null })).toBe('at or below 90');
    expect(page.describeRange({ low: 120, high: null, refText: null })).toBe('at or above 120');
    expect(page.describeRange({ low: null, high: null, refText: 'For 8 a.m. specimens' })).toBe(
      'For 8 a.m. specimens',
    );
  });

  // Which dose markers this metric's chart shows first — display config the household owns
  // (data-model.md → ChartOverlayDefault), never a recorded relationship.
  describe('chart defaults', () => {
    const withDefaults = (overlays: Array<{ id: string; kind: string; value: string }>) => (url: string) =>
      url === '/analytes/a1/chart-defaults' ? of({ overlays }) : routeGets(url);

    it('lists the configured defaults, worded as display rather than as a relationship', () => {
      apiMock.get = jest.fn(withDefaults([{ id: 'c1', kind: 'medication_tag', value: 'antipyretic' }]));
      const fixture = TestBed.createComponent(AnalyteDetailPage);
      fixture.detectChanges();
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('Doses shown on this chart by default');
      expect(text).toContain('antipyretic');
      // P6: the page never claims the doses do anything to the readings.
      expect(text.toLowerCase()).not.toContain('affect');
      expect(text.toLowerCase()).not.toContain('related to');
    });

    it('says so plainly when a chart has no defaults', () => {
      apiMock.get = jest.fn(withDefaults([]));
      const fixture = TestBed.createComponent(AnalyteDetailPage);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No doses shown by default');
    });

    it('adds a tag by sending the whole list, and refreshes the history the markers come from', () => {
      apiMock.get = jest.fn(withDefaults([{ id: 'c1', kind: 'medication_tag', value: 'antipyretic' }]));
      apiMock.put = jest.fn(() =>
        of({
          overlays: [
            { id: 'c1', kind: 'medication_tag', value: 'antipyretic' },
            { id: 'c2', kind: 'medication_tag', value: 'analgesic' },
          ],
        }),
      );
      const fixture = TestBed.createComponent(AnalyteDetailPage);
      fixture.detectChanges();
      fixture.componentInstance.selectPatient('p1');
      fixture.detectChanges();
      apiMock.get.mockClear();

      fixture.componentInstance.newChartDefault = 'analgesic';
      fixture.componentInstance.addChartDefault();
      fixture.detectChanges();

      expect(apiMock.put).toHaveBeenCalledWith('/analytes/a1/chart-defaults', {
        overlays: [
          { kind: 'medication_tag', value: 'antipyretic' },
          { kind: 'medication_tag', value: 'analgesic' },
        ],
      });
      expect(fixture.componentInstance.chartDefaults().map((o: any) => o.value)).toEqual([
        'antipyretic',
        'analgesic',
      ]);
      // The history payload carries the markers, so it has to be refetched after a change.
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/analytes/a1/history');
    });

    it('removes a tag by sending the remaining list, empty included', () => {
      apiMock.get = jest.fn(withDefaults([{ id: 'c1', kind: 'medication_tag', value: 'antipyretic' }]));
      apiMock.put = jest.fn(() => of({ overlays: [] }));
      const fixture = TestBed.createComponent(AnalyteDetailPage);
      fixture.detectChanges();

      fixture.componentInstance.removeChartDefault('antipyretic');
      fixture.detectChanges();

      expect(apiMock.put).toHaveBeenCalledWith('/analytes/a1/chart-defaults', { overlays: [] });
      expect(fixture.componentInstance.chartDefaults()).toEqual([]);
    });

    it('plots the history payload\'s doses as markers, dropping any outside the plotted span', () => {
      apiMock.get = jest.fn((url: string) => {
        if (url === '/analytes/a1/chart-defaults') {
          return of({ overlays: [{ id: 'c1', kind: 'medication_tag', value: 'antipyretic' }] });
        }
        if (url === '/patients/p1/analytes/a1/history') {
          return of({
            ...HISTORY,
            doses: [
              // Inside the span between the two results.
              {
                interventionId: 'i1',
                performedAt: 1660000000,
                medicationId: 'm1',
                medicationName: 'ibuprofen',
                amountMg: 100,
                medicationTags: ['antipyretic'],
              },
              // Years before the first result — off the axis, so it is dropped rather than clamped
              // onto the edge where it would read as having happened then.
              {
                interventionId: 'i2',
                performedAt: 1500000000,
                medicationId: 'm1',
                medicationName: 'ibuprofen',
                amountMg: 100,
                medicationTags: ['antipyretic'],
              },
            ],
          });
        }
        return routeGets(url);
      });

      const fixture = TestBed.createComponent(AnalyteDetailPage);
      fixture.detectChanges();
      fixture.componentInstance.selectPatient('p1');
      fixture.detectChanges();

      const doses = fixture.componentInstance.plottedDoses();
      expect(doses).toHaveLength(1);
      expect(doses[0].title).toContain('ibuprofen');
      expect(doses[0].title).toContain('100 mg');
      expect(fixture.componentInstance.chartDefaultLegend()).toBe('antipyretic doses');
      expect(fixture.nativeElement.textContent).toContain('Showing antipyretic doses by default');
    });
  });
});
