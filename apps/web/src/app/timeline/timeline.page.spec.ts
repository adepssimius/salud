import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TimelinePage } from './timeline.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

const patient = { id: 'p1', fullName: 'Jamie Doe' } as any;

const timelineResponse = {
  patient,
  weightPrompt: { needsUpdate: false, lastRecordedAt: 1700000000, daysSince: 3 },
  entries: [
    {
      id: 'obs-1',
      kind: 'observation',
      type: 'temperature',
      timestamp: 1700000000,
      display: {
        id: 'obs-1',
        observedAt: 1700000000,
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      },
    },
    {
      id: 'int-1',
      kind: 'intervention',
      type: 'medication_dose',
      timestamp: 1700003600,
      display: {
        id: 'int-1',
        performedAt: 1700003600,
        metadata: { medicationId: 'm1', amountMg: 160, isAtypical: false },
      },
    },
  ],
};

const medications = [{ id: 'm1', name: 'Acetaminophen', brandNames: ['Tylenol'], tags: ['fever'] }] as any;

const episodes = [
  { id: 'ep1', patientId: 'p1', name: 'Fever Jan 2025', status: 'active', startedAt: 1699999000, endedAt: null },
];

describe('TimelinePage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/medications') return of(medications);
        if (path.endsWith('/episodes')) return of(episodes);
        return of(timelineResponse);
      }),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TimelinePage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  it('loads timeline, medications, and episodes on init', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', {});
    expect(apiMock.get).toHaveBeenCalledWith('/medications');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Jamie Doe');
  });

  it('extracts temperature points in Celsius when the viewer has no preference set', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    const points = fixture.componentInstance.temperaturePoints();
    expect(points).toEqual([{ timestamp: 1700000000, value: 38.5 }]);
    expect(fixture.componentInstance.tempUnit()).toBe('C');
  });

  it('normalizes the curve to the caregiver preferred unit (product.md: "graphs normalize to the preferred unit")', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: {
        user: () => ({ preferredTempUnit: 'F', preferredWeightUnit: 'kg', preferredLengthUnit: 'cm' }),
      },
    });
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    const points = fixture.componentInstance.temperaturePoints();
    expect(fixture.componentInstance.tempUnit()).toBe('F');
    expect(points).toEqual([{ timestamp: 1700000000, value: 101.3 }]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('°F');
    expect(text).not.toContain('°C');
  });

  it('extracts dose markers from medication_dose interventions', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    const markers = fixture.componentInstance.doseMarkers();
    expect(markers).toEqual([
      { timestamp: 1700003600, amountMg: 160, medicationId: 'm1', isAtypical: false },
    ]);
  });

  it('computes episode bands clamped to the visible time range', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    const bands = fixture.componentInstance.episodeBands();
    expect(bands.length).toBe(1);
    expect(bands[0].name).toBe('Fever Jan 2025');
    expect(bands[0].width).toBeGreaterThan(0);
  });

  it('filterByMedication sets the filter and reloads with medicationId param', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    fixture.componentInstance.filterByMedication('m1');
    expect(fixture.componentInstance.selectedMedicationId()).toBe('m1');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', { medicationId: 'm1' });
  });

  it('filterByTag sets the filter and clears medication filter', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    fixture.componentInstance.filterByTag('fever');
    expect(fixture.componentInstance.selectedTag()).toBe('fever');
    expect(fixture.componentInstance.selectedMedicationId()).toBeNull();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', { medicationTag: 'fever' });
  });

  it('backToPatient navigates to the patient detail page', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    fixture.componentInstance.backToPatient();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1']);
  });

  it('goToEpisode navigates to the episode detail page when a band is clicked', () => {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.detectChanges();
    fixture.componentInstance.goToEpisode('ep1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
  });
});
