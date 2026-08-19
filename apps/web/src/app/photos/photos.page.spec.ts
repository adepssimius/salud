import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PhotosPage } from './photos.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PatientHubStore } from '../patients/patient-hub.store';

const DAY = 86400;
const day1 = 1_700_000_000;
const day2 = day1 + DAY;
const day3 = day1 + 2 * DAY;

const observation = (id: string, observedAt: number, entries: any[], recordedByUserId = 'u1'): any => ({
  id,
  patientId: 'p1',
  recordedByUserId,
  observedAt,
  text: null,
  episodeIds: [],
  resolvesEpisodeIds: [],
  entries,
  unitPreferenceAtEntry: null,
  createdAt: observedAt,
  updatedAt: observedAt,
});

const photo = (metadata: any) => ({ id: `e-${metadata.fileId}`, type: 'photo', metadata });

// Newest first, as the API returns them: a left ear photographed three days running, the right
// ear once, plus a temperature riding along in the same multi-entry save.
const photoObservations = [
  observation('o4', day3, [photo({ fileId: 'f-right', bodyLocation: 'Ear drum', side: 'right' })], 'u2'),
  observation('o3', day3, [photo({ fileId: 'f-left-3', bodyLocation: 'ear DRUM', side: 'left', sizeCm: 2.54, note: 'less red' })]),
  observation('o2', day2, [
    { id: 'e-temp', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } },
    photo({ fileId: 'f-left-2', bodyLocation: 'Ear drum', side: 'left' }),
  ]),
  observation('o1', day1, [photo({ fileId: 'f-left-1', bodyLocation: 'Ear drum', side: 'left' })]),
];

describe('PhotosPage', () => {
  let apiMock: any;

  const build = (observations: any = photoObservations) => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/patients/p1/observations' ? of(observations) : of([]),
    );
    const store = TestBed.inject(PatientHubStore);
    store.patientId.set('p1');
    store.careTeam.set([
      { user: { id: 'u1', email: 'dana@example.com', displayName: 'Dana' }, role: 'owner' },
      { user: { id: 'u2', email: 'sam@example.com', displayName: 'Sam Nightshift' }, role: 'caregiver' },
    ] as any);
    const fixture = TestBed.createComponent(PhotosPage);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    apiMock = {
      get: jest.fn(() => of([])),
      getBlob: jest.fn(() => of(new Blob(['x'], { type: 'image/png' }))),
    };
    (URL as any).createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/fake');
    (URL as any).revokeObjectURL = jest.fn();

    await TestBed.configureTestingModule({
      imports: [PhotosPage],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1', preferredLengthUnit: 'cm' }) } },
      ],
    }).compileComponents();
  });

  it('asks the existing observations endpoint for photo entries only', () => {
    build();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/observations', { type: 'photo' });
  });

  it('lists one row per photographed site, with its count and latest date', () => {
    const fixture = build();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.site-button')).map((b: any) =>
      b.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toHaveLength(2);
    // Recorded casing verbatim, grouped case-insensitively — three left-ear photos in one row.
    expect(rows.some((r: string) => r.includes('ear DRUM · left') && r.includes('3 photos'))).toBe(true);
    expect(rows.some((r: string) => r.includes('Ear drum · right') && r.includes('1 photo'))).toBe(true);
  });

  it('shows one thumbnail per site — the most recent photo of it', () => {
    const fixture = build();
    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f-left-3');
    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f-right');
    expect(apiMock.getBlob).not.toHaveBeenCalledWith('/files/f-left-1');
  });

  it('shows a selected site as a filmstrip, oldest photo first', () => {
    const fixture = build();
    const left = fixture.componentInstance.sites().find((s: any) => s.side === 'left')!;
    fixture.componentInstance.selectSite(left.key);
    fixture.detectChanges();

    const frames = fixture.nativeElement.querySelectorAll('.frame');
    expect(frames).toHaveLength(3);
    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f-left-1');
    expect(fixture.componentInstance.selectedSite()!.photos.map((p: any) => p.fileId)).toEqual([
      'f-left-1',
      'f-left-2',
      'f-left-3',
    ]);
  });

  // P3 — the log is only useful if it says who recorded what.
  it('attributes each photo to the caregiver who recorded it, and shows size and note', () => {
    const fixture = build();
    const left = fixture.componentInstance.sites().find((s: any) => s.side === 'left')!;
    fixture.componentInstance.selectSite(left.key);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('by Dana');
    expect(text).toContain('2.5 cm');
    expect(text).toContain('less red');
  });

  it('converts the stored size into the viewer’s length preference', () => {
    TestBed.overrideProvider(AuthService, {
      useValue: { user: () => ({ id: 'u1', preferredLengthUnit: 'in' }) },
    });
    const fixture = build();
    const left = fixture.componentInstance.sites().find((s: any) => s.side === 'left')!;
    fixture.componentInstance.selectSite(left.key);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 in');
  });

  it('returns to the site list from a filmstrip', () => {
    const fixture = build();
    fixture.componentInstance.selectSite(fixture.componentInstance.sites()[0].key);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.site-button')).toBeNull();

    fixture.componentInstance.clearSite();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.site-button')).toHaveLength(2);
  });

  it('says so plainly when the patient has no photos', () => {
    const fixture = build([]);
    expect(fixture.nativeElement.textContent).toContain('No photos yet for this patient');
    expect(fixture.nativeElement.querySelector('.site-button')).toBeNull();
  });

  it('buckets a photo with no body location rather than dropping or crashing on it', () => {
    const fixture = build([observation('o9', day1, [photo({ fileId: 'f-orphan', side: 'n/a' })])]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Unspecified site');
    expect(fixture.componentInstance.sites()).toHaveLength(1);
  });

  it('reports a failure instead of showing an empty gallery', () => {
    apiMock.get.mockImplementation(() => throwError(() => ({ error: { message: 'boom' } })));
    TestBed.inject(PatientHubStore).patientId.set('p1');
    const fixture = TestBed.createComponent(PhotosPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Could not load photos.');
    expect(fixture.nativeElement.textContent).not.toContain('No photos yet for this patient');
  });
});
