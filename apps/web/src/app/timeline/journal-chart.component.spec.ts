import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/auth.service';
import { JournalChartComponent } from './journal-chart.component';

const entries = [
  {
    id: 'obs-1',
    kind: 'observation',
    type: 'temperature',
    timestamp: 1700000000,
    recordedBy: { id: 'u1', displayName: 'Dana' },
    display: {
      id: 'obs-1',
      observedAt: 1700000000,
      createdAt: 1700000000,
      entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
    },
  },
  {
    id: 'int-1',
    kind: 'intervention',
    type: 'medication_dose',
    timestamp: 1700003600,
    recordedBy: { id: 'u1', displayName: 'Dana' },
    display: {
      id: 'int-1',
      performedAt: 1700003600,
      createdAt: 1700003600,
      metadata: { medicationId: 'm1', amountMg: 160, isAtypical: false },
    },
  },
] as any;

const episodes = [
  { id: 'ep1', patientId: 'p1', name: 'Fever Jan 2025', status: 'active', startedAt: 1699999000, endedAt: null },
] as any;

describe('JournalChartComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JournalChartComponent],
      // No signed-in viewer by default: the chart falls back to canonical units, exactly as it does
      // on the public shared-brief route.
      providers: [{ provide: AuthService, useValue: { user: () => null } }],
    }).compileComponents();
  });

  function render(temperatureRanges: any[] = []) {
    const fixture = TestBed.createComponent(JournalChartComponent);
    fixture.componentInstance.entries = entries;
    fixture.componentInstance.episodes = episodes;
    fixture.componentInstance.temperatureRanges = temperatureRanges;
    fixture.detectChanges();
    return fixture;
  }

  const normalBand = {
    id: 'r1',
    kind: 'reference' as const,
    label: 'Normal',
    low: 36.1,
    high: 37.2,
    refText: null,
    effectiveFrom: 0,
  };

  it('extracts temperature points in Celsius when the viewer has no preference set', () => {
    const fixture = render();
    expect(fixture.componentInstance.temperaturePoints()).toEqual([{ timestamp: 1700000000, value: 38.5 }]);
    expect(fixture.componentInstance.tempUnit()).toBe('C');
  });

  it('normalizes the curve to the caregiver preferred unit (product.md: "graphs normalize to the preferred unit")', () => {
    TestBed.overrideProvider(AuthService, {
      useValue: { user: () => ({ preferredTempUnit: 'F', preferredWeightUnit: 'kg', preferredLengthUnit: 'cm' }) },
    });
    const fixture = render();
    expect(fixture.componentInstance.tempUnit()).toBe('F');
    expect(fixture.componentInstance.temperaturePoints()).toEqual([{ timestamp: 1700000000, value: 101.3 }]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('°F');
    expect(text).not.toContain('°C');
  });

  it('extracts dose markers from medication_dose interventions', () => {
    const fixture = render();
    expect(fixture.componentInstance.doseMarkers()).toEqual([
      { timestamp: 1700003600, amountMg: 160, medicationId: 'm1', isAtypical: false },
    ]);
  });

  it('computes episode bands clamped to the visible time range', () => {
    const fixture = render();
    const bands = fixture.componentInstance.episodeBands();
    expect(bands.length).toBe(1);
    expect(bands[0].name).toBe('Fever Jan 2025');
    expect(bands[0].width).toBeGreaterThan(0);
  });

  it('emits the episode id when a band is clicked, leaving navigation to the page', () => {
    const fixture = render();
    const emitted: string[] = [];
    fixture.componentInstance.episodeSelected.subscribe((id: string) => emitted.push(id));
    fixture.nativeElement.querySelector('.episode-band').dispatchEvent(new MouseEvent('click'));
    expect(emitted).toEqual(['ep1']);
  });

  it('folds the band bounds into the y-domain, so a band below every reading still renders', () => {
    // The single reading is 38.5 °C; the band tops out at 37.2. Scaled to the reading alone the
    // band would sit off the chart — the same rule the analyte history chart follows.
    const fixture = render([normalBand]);
    const comp = fixture.componentInstance;

    expect(comp.scaleLow()).toBeLessThanOrEqual(36.1);
    expect(comp.scaleHigh()).toBeGreaterThanOrEqual(38.5);
    const band = comp.plottedBands()[0];
    expect(band.height).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('.value-band')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Normal 36.1–37.2 °C');
  });

  it('renders a scale but no band when the patient has none recorded', () => {
    const fixture = render();
    expect(fixture.componentInstance.plottedBands()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.value-band')).toBeNull();
    // The scale is unconditional — "how high is it" is answerable without any band at all.
    expect(fixture.nativeElement.querySelector('.axis-label')).not.toBeNull();
  });

  // P6: the overlay is the raw series. No "responsive to X" annotation ever renders on or near a
  // dose marker — the reader draws that conclusion, not the app.
  it('renders no interpretation alongside the dose markers', () => {
    const fixture = render();
    const text: string = fixture.nativeElement.textContent;
    expect(text.toLowerCase()).not.toContain('responsive');
    expect(text.toLowerCase()).not.toContain('effective');
  });
});
