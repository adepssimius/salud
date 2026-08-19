import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ObservationDetailPage } from './observation-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

const observation = {
  id: 'obs-1',
  patientId: 'p1',
  recordedByUserId: 'u2',
  observedAt: 1700000000,
  text: 'Woke up hot, gave a bath.',
  episodeIds: ['ep1'],
  resolvesEpisodeIds: ['ep2'],
  unitPreferenceAtEntry: { temp: 'C', weight: 'kg', length: 'cm' },
  createdAt: 1700003600,
  updatedAt: 1700003600,
  entries: [
    { id: 'e1', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'tympanic' } },
    {
      id: 'e2',
      type: 'photo',
      metadata: { fileId: 'f1', bodyLocation: 'tympanic membrane', side: 'left', sizeCm: 2.1, note: 'less red' },
    },
    { id: 'e3', type: 'document', metadata: { fileId: 'f2', label: 'Discharge summary' } },
    {
      id: 'e4',
      type: 'lab_result',
      metadata: { analyteId: 'a1', analyte: 'FERRITIN', valueText: '18', unit: 'ng/mL', flag: 'L' },
      labContext: {
        displayName: 'Ferritin',
        ranges: [{ id: 'r1', kind: 'reference', label: 'Reference', low: 30, high: 400, refText: null, effectiveFrom: 1 }],
      },
    },
  ],
};

const episodes = [
  {
    id: 'ep1',
    patientId: 'p1',
    name: 'Fever',
    status: 'active',
    startedAtType: 'observation',
    startedAtId: 'obs-1',
    startedAt: 1700000000,
    endedAt: null,
  },
  {
    id: 'ep2',
    patientId: 'p1',
    name: 'Ear infection',
    status: 'resolved',
    startedAtType: 'observation',
    startedAtId: 'obs-0',
    startedAt: 1699000000,
    endedAt: 1700000000,
  },
];

const careTeam = [
  { user: { id: 'u2', email: 'sam@example.com', displayName: 'Sam Nightshift' }, role: 'co-parent' },
];

describe('ObservationDetailPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    (URL as any).createObjectURL = jest.fn().mockReturnValue('blob:photo');
    (URL as any).revokeObjectURL = jest.fn();

    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/observations/obs-1') return of(observation);
        if (path === '/patients/p1/episodes') return of(episodes);
        if (path === '/patients/p1/care-team') return of(careTeam);
        if (path === '/observations/obs-1/revisions') return of([]);
        return of(null);
      }),
      getBlob: jest.fn(() => of(new Blob(['x']))),
    };
    authMock = {
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      }),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ObservationDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'obs-1']]) } } },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(ObservationDetailPage);
    fixture.detectChanges();
    return fixture;
  }

  it('loads the observation and then its patient-scoped context', () => {
    const fixture = render();
    expect(apiMock.get).toHaveBeenCalledWith('/observations/obs-1');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/care-team');
    expect(fixture.componentInstance.observation()?.id).toBe('obs-1');
  });

  it('renders every entry by type, converting to the reader unit preference', () => {
    const fixture = render();
    const rows = fixture.componentInstance.rows();
    expect(rows.map((r) => r.label)).toEqual(['Temperature', 'Photo', 'Document', 'Lab result']);
    // Stored °C, reader prefers °F — the value converts, the method rides along.
    expect(rows[0].summary).toBe('Temp 101.3 °F (tympanic)');
  });

  it('shows a photo large, with its metadata as the caption', () => {
    const fixture = render();
    const thumb = fixture.nativeElement.querySelector('app-photo-thumbnail');
    expect(thumb).not.toBeNull();
    expect(thumb.querySelector('.photo-thumb.large')).not.toBeNull();
    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f1');
    const caption = fixture.componentInstance.rows()[1].summary;
    expect(caption).toContain('tympanic membrane');
    expect(caption).toContain('(left)');
    expect(caption).toContain('2.1 cm');
    expect(caption).toContain('less red');
  });

  it('renders a document entry as an attachment link rather than a bare summary', () => {
    const fixture = render();
    const link = fixture.nativeElement.querySelector('app-document-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Discharge summary');
  });

  it('names a lab result from labContext and lists the patient ranges beside it', () => {
    const fixture = render();
    const labRow = fixture.componentInstance.rows()[3];
    expect(labRow.summary).toContain('Ferritin');
    expect(labRow.summary).toContain('(L)'); // the printed flag, never one the page computed
    expect(labRow.ranges.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Reference 30–400');
  });

  it('attributes the entry through the care team, and separates log time from clinical time', () => {
    const fixture = render();
    expect(fixture.componentInstance.recordedByName()).toBe('Sam Nightshift');
    expect(fixture.nativeElement.textContent).toContain('Recorded by Sam Nightshift');
    expect(fixture.nativeElement.textContent).toContain('logged');
  });

  it('says "Unknown caregiver" rather than printing a raw id for someone off the care team', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/observations/obs-1') return of(observation);
      if (path === '/patients/p1/care-team') return of([]);
      return of([]);
    });
    const fixture = render();
    expect(fixture.componentInstance.recordedByName()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Unknown caregiver');
    expect(fixture.nativeElement.textContent).not.toContain('u2');
  });

  it('labels the units the recorder had on screen, separately from the reader preference', () => {
    const fixture = render();
    expect(fixture.componentInstance.enteredInLabel()).toBe('°C · kg · cm');
    expect(fixture.nativeElement.textContent).toContain('Entered in °C · kg · cm');
  });

  it('lists episode links as the union of membership and resolution, labeled by role', () => {
    const fixture = render();
    expect(fixture.componentInstance.episodeLinks()).toEqual([
      { id: 'ep1', name: 'Fever', role: 'started' },
      { id: 'ep2', name: 'Ear infection', role: 'resolved' },
    ]);
  });

  it('falls back to a generic episode name when the episode list fails to load', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/observations/obs-1') return of(observation);
      if (path === '/patients/p1/care-team') return of(careTeam);
      return throwError(() => new Error('nope'));
    });
    const fixture = render();
    expect(fixture.componentInstance.episodeLinks().map((e) => e.name)).toEqual(['Episode', 'Episode']);
    // The entries are the record; a context failure must not blank them.
    expect(fixture.componentInstance.rows().length).toBe(4);
  });

  it('renders the revision history section read-only', () => {
    const fixture = render();
    expect(apiMock.get).toHaveBeenCalledWith('/observations/obs-1/revisions');
    expect(fixture.nativeElement.textContent).toContain('History');
    expect(fixture.nativeElement.textContent).toContain('this page does not edit');
  });

  it('shows an error when the observation itself fails to load', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = render();
    expect(fixture.componentInstance.error()).toBe('Unable to load this observation.');
  });

  it('navigates to an episode and back to the patient journal', () => {
    const fixture = render();
    const comp = fixture.componentInstance;
    comp.goToEpisode('ep1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
    comp.backToJournal();
    expect(routerMock.navigate).toHaveBeenLastCalledWith(['/patients', 'p1', 'journal']);
  });

  it('backToJournal falls back to the dashboard when the observation never loaded', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = render();
    fixture.componentInstance.backToJournal();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
