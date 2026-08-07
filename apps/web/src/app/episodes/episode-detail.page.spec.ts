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
