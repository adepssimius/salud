import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EpisodeDetailPage } from './episode-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

const baseEpisode = {
  id: 'ep1',
  patientId: 'p1',
  conditionId: null,
  name: 'Fever Jan 2025',
  status: 'active',
  startedAtType: 'observation',
  startedAtId: 'obs1',
  endedAtType: null,
  endedAtId: null,
  startedAt: 1700000000,
  endedAt: null,
  notes: 'Started after school pickup.',
  observationIds: ['obs1'],
  interventionIds: [],
  createdAt: 1700000000,
  updatedAt: 1700000000,
};

describe('EpisodeDetailPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/episodes/ep1') return of(baseEpisode);
        if (path.includes('/timeline')) {
          return of({
            patient: { id: 'p1' },
            weightPrompt: { needsUpdate: false, lastRecordedAt: null, daysSince: null },
            entries: [
              {
                id: 'obs1',
                kind: 'observation',
                type: 'temperature',
                timestamp: 1700000000,
                display: { entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }] },
              },
            ],
          });
        }
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
        preferredWeightUnit: 'kg',
      }),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [EpisodeDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'ep1']]) } } },
      ],
    }).compileComponents();
  });

  it('loads the episode, then its events from the episode-filtered timeline', () => {
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.episode()?.name).toBe('Fever Jan 2025');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', { episodeId: 'ep1' });
    expect(comp.events().length).toBe(1);
    expect(comp.events()[0].id).toBe('obs1');
  });

  it('splits advisory entries out of the events list', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/episodes/ep1') return of(baseEpisode);
      if (path.includes('/timeline')) {
        return of({
          patient: { id: 'p1' },
          weightPrompt: { needsUpdate: false, lastRecordedAt: null, daysSince: null },
          entries: [
            {
              id: 'obs1',
              kind: 'observation',
              type: 'temperature',
              timestamp: 1700000000,
              display: { entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }] },
            },
            {
              id: 'adv1',
              kind: 'advisory',
              type: 'protocol_fired',
              timestamp: 1700000100,
              display: { id: 'adv1', payload: { protocolName: 'Fever with port' } },
            },
          ],
        });
      }
      return of(null);
    });
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.events().length).toBe(1);
    expect(comp.advisories().length).toBe(1);
    expect((comp.advisories()[0] as any).payload.protocolName).toBe('Fever with port');
  });

  it('shows an error when the episode fails to load', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.error()).toBe('Unable to load this episode.');
  });

  it('shows an error when the timeline fails to load', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/episodes/ep1') return of(baseEpisode);
      return throwError(() => new Error('fail'));
    });
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.error()).toBe('Unable to load this episode’s events.');
  });

  it('links an event row through to its read-only detail page', () => {
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.feed-text-link').click();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations', 'obs1']);
  });

  it('resolveEpisode hands off to new-observation with patientId and resolveEpisodeId', () => {
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.resolveEpisode();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations/new'], {
      queryParams: { patientId: 'p1', resolveEpisodeId: 'ep1' },
    });
  });

  it('goToErBrief navigates to the patient ER Brief scoped to this episode', () => {
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.goToErBrief();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'er-brief'], {
      queryParams: { episodeId: 'ep1' },
    });
  });

  it('backToPatient navigates to the patient detail page', () => {
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.backToPatient();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1']);
  });

  it('backToPatient falls back to the dashboard when the episode never loaded', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.backToPatient();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});

describe('EpisodeDetailPage membership editing', () => {
  const resolvedEpisode = {
    ...baseEpisode,
    status: 'resolved',
    endedAtType: 'observation',
    endedAtId: 'obs2',
    endedAt: 1700100000,
    observationIds: ['obs1', 'obs2'],
  };
  const timeline = (ids: string[]) => ({
    patient: { id: 'p1' },
    weightPrompt: { needsUpdate: false, lastRecordedAt: null, daysSince: null },
    entries: ids.map((id, i) => ({
      id,
      kind: 'observation',
      type: 'temperature',
      timestamp: 1700000000 + i * 100000,
      display: { entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }] },
    })),
  });
  let apiMock: any;

  const build = async (episode: any, ids: string[]) => {
    apiMock = {
      get: jest.fn((path: string, params?: any) => {
        if (path === '/episodes/ep1') return of(episode);
        if (path.includes('/timeline') && params?.episodeId) return of(timeline(ids));
        if (path.includes('/timeline')) return of(timeline(['obs1', 'obs2', 'obs3']));
        if (path === '/medications') return of([]);
        return of(null);
      }),
      post: jest.fn(() => of({ ...episode })),
    };
    await TestBed.configureTestingModule({
      imports: [EpisodeDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: { user: () => null } },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'ep1']]) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    // Remove lives behind Edit (frontend.md → Episode detail → the log), so turn it on.
    fixture.componentInstance.toggleEditing();
    fixture.detectChanges();
    return fixture;
  };

  it('hides Remove until Edit is pressed', async () => {
    const fixture = await build(resolvedEpisode, ['obs1', 'obs2']);
    fixture.componentInstance.toggleEditing();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button.remove')).toHaveLength(0);
  });

  const removeButtons = (fixture: any) =>
    Array.from(fixture.nativeElement.querySelectorAll('button.remove')) as HTMLButtonElement[];

  const rowOf = (fixture: any, text: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('ul.events li')) as HTMLElement[]).find((li) =>
      li.textContent?.includes(text),
    )!;
  const removeIn = (fixture: any, pill: string) => rowOf(fixture, pill).querySelector('button.remove') as HTMLButtonElement;

  it('offers Remove on every entry, the start included', async () => {
    const fixture = await build(resolvedEpisode, ['obs1', 'obs2']);
    expect(fixture.nativeElement.textContent).toContain('started this episode');
    expect(removeButtons(fixture)).toHaveLength(2);
    expect(removeIn(fixture, 'started this episode')).not.toBeNull();
  });

  it('offers no Remove on a lone entry', async () => {
    const fixture = await build({ ...baseEpisode, observationIds: ['obs1'] }, ['obs1']);
    expect(removeButtons(fixture)).toHaveLength(0);
  });

  it('removes the start without a confirm and moves the pill to the start the API returns', async () => {
    const fixture = await build({ ...baseEpisode, startedAtId: 'obs1', observationIds: ['obs1', 'obs2'] }, ['obs1', 'obs2']);
    const confirm = jest.spyOn(window, 'confirm');
    apiMock.post.mockReturnValueOnce(
      of({ ...baseEpisode, startedAtId: 'obs2', startedAt: 1700100000, observationIds: ['obs2'] }),
    );
    // Both rows still render (the stubbed timeline does not shrink), so the pill's row is the check.
    removeIn(fixture, 'started this episode').click();
    fixture.detectChanges();
    expect(confirm).not.toHaveBeenCalled();
    expect(apiMock.post).toHaveBeenCalledWith('/episodes/ep1/events', {
      remove: [{ type: 'observation', id: 'obs1' }],
    });
    expect(fixture.componentInstance.isStart({ kind: 'observation', id: 'obs2' } as any)).toBe(true);
    expect(fixture.componentInstance.isStart({ kind: 'observation', id: 'obs1' } as any)).toBe(false);
    confirm.mockRestore();
  });

  it('confirms before removing the entry that ended the episode, then posts the removal', async () => {
    const fixture = await build(resolvedEpisode, ['obs1', 'obs2']);
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    removeIn(fixture, 'ended it').click();
    expect(confirm).toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();

    removeIn(fixture, 'ended it').click();
    expect(apiMock.post).toHaveBeenCalledWith('/episodes/ep1/events', {
      remove: [{ type: 'observation', id: 'obs2' }],
    });
    confirm.mockRestore();
  });

  it('adds picked entries, offering only those not already in the episode', async () => {
    const fixture = await build(baseEpisode, ['obs1']);
    const comp = fixture.componentInstance;
    comp.startAdding();
    fixture.detectChanges();

    const boxes = Array.from(fixture.nativeElement.querySelectorAll('app-episode-entry-picker input[type=checkbox]')) as HTMLInputElement[];
    expect(boxes).toHaveLength(2); // obs3 and obs2, newest first; obs1 is already a member
    boxes[0].click();
    fixture.detectChanges();
    comp.addSelected();
    expect(apiMock.post).toHaveBeenCalledWith('/episodes/ep1/events', { add: [{ type: 'observation', id: 'obs3' }] });
    expect(comp.adding()).toBe(false);
  });

  it('shows the API error sentence when a change is rejected', async () => {
    const fixture = await build(baseEpisode, ['obs1', 'obs2']);
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'EPISODE_EVENT_NOT_FOUND' } })));
    removeButtons(fixture)[0].click();
    expect(fixture.componentInstance.error()).toContain('no longer available');
  });
});

// The redesigned sections (frontend.md → Episode detail): where are we, keeping up, is it getting
// better, and the log. Times are built in local time so day boundaries hold in any CI zone.
describe('EpisodeDetailPage course view', () => {
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  const dose = (id: string, ts: number, scheduleId: string | null = null) => ({
    id,
    kind: 'intervention',
    type: 'medication_dose',
    timestamp: ts,
    display: { type: 'medication_dose', scheduleId, metadata: { medicationId: 'cream', medicationEmbodimentId: 'emb' } },
  });
  const lesion = (id: string, ts: number, photo: boolean) => ({
    id,
    kind: 'observation',
    type: 'observation',
    timestamp: ts,
    display: {
      entries: [
        { type: 'lesion_size', metadata: { lengthCm: 2.5, widthCm: 1.8, bodyLocation: 'inner thigh', side: 'left' } },
        ...(photo ? [{ type: 'photo', metadata: { fileId: 'f1', bodyLocation: 'inner thigh', side: 'left' } }] : []),
      ],
    },
  });
  const medications = [{ id: 'cream', name: 'clotrimazole', embodiments: [{ id: 'emb', label: '1% cream', dosageForm: 'cream' }] }];
  const schedule = {
    id: 's1',
    patientId: 'p1',
    type: 'medication_dose',
    medicationId: 'cream',
    medicationEmbodimentId: 'emb',
    episodeId: 'ep1',
    label: 'Clotrimazole twice daily',
    frequencyHours: null,
    explicitTimes: ['08:00', '20:00'],
    startAt: at(3, 7),
    endAfterOccurrences: 28,
    endAt: null,
    status: 'active',
    adherence: { expectedCount: 0, loggedCount: 0, missed: 0, remainingOccurrences: 28, overdue: false },
  };
  const entries = [
    lesion('obs1', at(3, 7), false),
    dose('d1', at(3, 8), 's1'),
    dose('d2', at(3, 20)),
    dose('d3', at(2, 8)),
    lesion('obs2', at(1, 9), true),
  ];
  let routerMock: any;

  const build = async (episodeOver: any) => {
    routerMock = { navigate: jest.fn() };
    const episode = { ...baseEpisode, startedAt: at(3, 7), observationIds: ['obs1', 'obs2'], medications, schedules: [], ...episodeOver };
    await TestBed.configureTestingModule({
      imports: [EpisodeDetailPage],
      providers: [
        {
          provide: ApiClientService,
          useValue: {
            get: jest.fn((path: string) =>
              path === '/episodes/ep1' ? of(episode) : path.includes('/timeline') ? of({ patient: { id: 'p1' }, entries }) : of(null),
            ),
            getBlob: jest.fn(() => of(new Blob())),
          },
        },
        { provide: AuthService, useValue: { user: () => null } },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'ep1']]) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EpisodeDetailPage);
    fixture.detectChanges();
    return fixture;
  };

  it('summarises the day, the treatment by name, the last dose and the last measurement', async () => {
    const fixture = await build({});
    const text = fixture.nativeElement.querySelector('.summary').textContent;
    expect(fixture.componentInstance.dayNumber()).toBe(4);
    expect(text).toContain('clotrimazole (1% cream)');
    expect(text).toContain('3 doses');
    expect(text).toContain('2.5 × 1.8 cm');
    expect(fixture.componentInstance.measurementIsOld()).toBe(false);
  });

  it('names the medicine on every dose line rather than "medication dose"', async () => {
    const fixture = await build({});
    expect(fixture.nativeElement.textContent).not.toContain('medication dose');
  });

  it('with no schedule, shows plain per-day counts and offers to add one', async () => {
    const fixture = await build({});
    const cells = Array.from(fixture.nativeElement.querySelectorAll('.strip .cell')) as HTMLElement[];
    expect(cells).toHaveLength(4);
    expect(cells.some((c) => c.classList.contains('short') || c.classList.contains('met'))).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('No schedule for this episode');
    fixture.componentInstance.addSchedule();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules/new'], { queryParams: { patientId: 'p1', episodeId: 'ep1' } });
  });

  it('with a schedule, counts linked doses only, names the unlinked ones with a way to link them, and marks short days', async () => {
    const fixture = await build({ schedules: [schedule] });
    const text = fixture.nativeElement.querySelector('.keeping-up').textContent.replace(/\s+/g, ' ');
    expect(text).toContain('1 of 28 doses');
    expect(text).toContain("2 doses of this medicine in this episode aren't linked to the schedule");
    fixture.componentInstance.linkDoses(schedule as any);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules', 's1'], { queryParams: { link: '1' } });
    const short = fixture.nativeElement.querySelectorAll('.strip .cell.short');
    expect(short.length).toBeGreaterThan(0);
  });

  it('puts the photos and sizes side by side, oldest first, saying when one has no photo', async () => {
    const fixture = await build({});
    const items = Array.from(fixture.nativeElement.querySelectorAll('.compare-item')) as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('No photo');
    expect(items[1].textContent).not.toContain('No photo');
  });
});
