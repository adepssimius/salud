import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { InterventionDetailPage } from './intervention-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

const dose = {
  id: 'int-1',
  patientId: 'p1',
  recordedByUserId: 'u2',
  performedAt: 1700000000,
  type: 'medication_dose',
  scheduleId: 's1',
  episodeIds: ['ep1'],
  resolvesEpisodeIds: [],
  notes: 'Took it without a fight.',
  createdAt: 1700000060,
  updatedAt: 1700000060,
  metadata: {
    medicationId: 'm1',
    medicationEmbodimentId: 'emb1',
    doseSource: 'weight_based',
    amountMg: 240,
    amountMl: 7.5,
    pillCount: null,
    weightKgUsed: 16,
    ageMonthsUsed: null,
    guidelineId: 'g1',
    interventionScheduleId: 's1',
    isAtypical: true,
    atypicalReason: 'interval_too_short,exceeds_max_per_dose',
    nextAllowedAt: 1700014400,
  },
};

const dressing = {
  id: 'int-2',
  patientId: 'p1',
  recordedByUserId: 'u2',
  performedAt: 1700000000,
  type: 'dressing_change',
  scheduleId: null,
  episodeIds: [],
  resolvesEpisodeIds: ['ep1'],
  notes: null,
  createdAt: 1700000000,
  updatedAt: 1700000000,
  metadata: { bodyLocation: 'left forearm', side: 'left', dressingType: 'hydrocolloid' },
};

const episodes = [
  {
    id: 'ep1',
    patientId: 'p1',
    name: 'Fever',
    status: 'active',
    startedAtType: 'intervention',
    startedAtId: 'int-9',
    startedAt: 1699000000,
    endedAt: null,
  },
];

const careTeam = [{ user: { id: 'u2', email: 'sam@example.com', displayName: 'Sam Nightshift' }, role: 'co-parent' }];
const medication = { id: 'm1', name: 'Ibuprofen', brandNames: ['Advil'], tags: ['antipyretic'] };
const embodiments = [
  { id: 'emb1', medicationId: 'm1', label: 'Infant suspension 32 mg/mL', concentrationMgPerMl: 32 },
  { id: 'emb2', medicationId: 'm1', label: 'Chewable 100 mg', concentrationMgPerMl: null },
];
const guideline = { id: 'g1', medicationId: 'm1', source: 'AAP 2023', type: 'weight_based', mgPerKg: 15 };
const schedule = { id: 's1', patientId: 'p1', label: 'Ibuprofen q6h', status: 'active' };

describe('InterventionDetailPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let entity: any;

  beforeEach(async () => {
    entity = dose;
    apiMock = {
      get: jest.fn((path: string) => {
        if (path.startsWith('/interventions/') && path.endsWith('/revisions')) return of([]);
        if (path.startsWith('/interventions/')) return of(entity);
        if (path === '/patients/p1/episodes') return of(episodes);
        if (path === '/patients/p1/care-team') return of(careTeam);
        if (path === '/medications/m1') return of(medication);
        if (path === '/medications/m1/embodiments') return of(embodiments);
        if (path === '/guidelines/g1') return of(guideline);
        if (path === '/schedules/s1') return of(schedule);
        return of(null);
      }),
    };
    authMock = {
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'lb',
      }),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [InterventionDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'int-1']]) } } },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(InterventionDetailPage);
    fixture.detectChanges();
    return fixture;
  }

  it('loads the intervention, then everything its stored ids point at', () => {
    render();
    expect(apiMock.get).toHaveBeenCalledWith('/interventions/int-1');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/care-team');
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1');
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1/embodiments');
    expect(apiMock.get).toHaveBeenCalledWith('/guidelines/g1');
    expect(apiMock.get).toHaveBeenCalledWith('/schedules/s1');
  });

  it('shows the dose provenance — amounts, source, inputs, guideline and countdown', () => {
    const fixture = render();
    const facts = fixture.componentInstance.facts();
    const labels = facts.map((f) => f.label);
    expect(labels).toEqual([
      'Amount',
      'Volume',
      'Dose source',
      'Weight used',
      'Guideline',
      'Next dose allowed',
    ]);
    expect(facts[0].value).toBe('240 mg');
    expect(facts[1].value).toBe('7.5 mL');
    expect(facts[2].value).toBe('Weight-based guideline');
    // Canonical kg converted to the reader's preferred weight unit.
    expect(facts[3].value).toBe('35.3 lb');
    expect(facts[4].value).toBe('AAP 2023 (weight-based)');
    expect(facts[5].value).toContain('can give now');
  });

  it('names the medication and its embodiment', () => {
    const fixture = render();
    expect(fixture.componentInstance.medication()?.name).toBe('Ibuprofen');
    expect(fixture.componentInstance.embodiment()?.label).toBe('Infant suspension 32 mg/mL');
    expect(fixture.nativeElement.textContent).toContain('Infant suspension 32 mg/mL');
  });

  it('spells out the atypical flag in the same words the advisory banner uses', () => {
    const fixture = render();
    expect(fixture.componentInstance.isAtypical()).toBe(true);
    expect(fixture.componentInstance.atypicalReasons()).toBe(
      'too soon since the last dose, exceeds max per dose',
    );
    expect(fixture.nativeElement.querySelector('.pill-danger')?.textContent).toContain('atypical');
  });

  it('says a cited guideline is gone rather than leaving the row blank', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/guidelines/g1') return throwError(() => new Error('gone'));
      if (path.startsWith('/interventions/') && path.endsWith('/revisions')) return of([]);
      if (path.startsWith('/interventions/')) return of(dose);
      if (path === '/medications/m1') return of(medication);
      if (path === '/medications/m1/embodiments') return of(embodiments);
      return of([]);
    });
    const fixture = render();
    const guidelineFact = fixture.componentInstance.facts().find((f) => f.label === 'Guideline');
    expect(guidelineFact?.value).toBe('Cited, but no longer in the catalog');
  });

  it('links the dose back to the schedule it came from', () => {
    const fixture = render();
    expect(fixture.componentInstance.schedule()?.label).toBe('Ibuprofen q6h');
    fixture.componentInstance.goToSchedule('s1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules', 's1']);
  });

  it('attributes the entry through the care team', () => {
    const fixture = render();
    expect(fixture.componentInstance.recordedByName()).toBe('Sam Nightshift');
    expect(fixture.nativeElement.textContent).toContain('Recorded by Sam Nightshift');
  });

  it('renders a dressing change with its site and material, and no dose fields', () => {
    entity = dressing;
    const fixture = render();
    expect(fixture.componentInstance.typeLabel()).toBe('Dressing change');
    expect(fixture.componentInstance.facts()).toEqual([
      { label: 'Body location', value: 'left forearm' },
      { label: 'Side', value: 'left' },
      { label: 'Dressing type', value: 'hydrocolloid' },
    ]);
    expect(apiMock.get).not.toHaveBeenCalledWith('/medications/m1');
  });

  it('labels an episode this entry resolved', () => {
    entity = dressing;
    const fixture = render();
    expect(fixture.componentInstance.episodeLinks()).toEqual([
      { id: 'ep1', name: 'Fever', role: 'resolved' },
    ]);
  });

  it('renders the revision history section read-only', () => {
    const fixture = render();
    expect(apiMock.get).toHaveBeenCalledWith('/interventions/int-1/revisions');
    expect(fixture.nativeElement.textContent).toContain('History');
    expect(fixture.nativeElement.textContent).toContain('this page does not edit');
  });

  it('shows an error when the intervention itself fails to load', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = render();
    expect(fixture.componentInstance.error()).toBe('Unable to load this intervention.');
    fixture.componentInstance.backToJournal();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('navigates back to the patient journal and out to the medication', () => {
    const fixture = render();
    fixture.componentInstance.backToJournal();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'journal']);
    fixture.componentInstance.goToMedication('m1');
    expect(routerMock.navigate).toHaveBeenLastCalledWith(['/medications', 'm1']);
  });
});
