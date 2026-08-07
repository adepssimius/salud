import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DashboardPage } from './dashboard.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { Router } from '@angular/router';

describe('DashboardPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  const emptyPayload = {
    lastDoses: [],
    activeEpisodes: [],
    upcomingSchedules: [],
    shoppingList: [],
    unacknowledgedAdvisories: [],
  };

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of(emptyPayload)),
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads the dashboard payload on init', () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/dashboard');
    expect(fixture.componentInstance.dashboard()).toEqual(emptyPayload);
  });

  it('navigates to the timeline for an episode', () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    fixture.componentInstance.goToTimeline('p1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'timeline']);
  });

  it('logDose navigates to new-intervention with scheduleId query param', () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    fixture.componentInstance.logDose('sched-1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions/new'], {
      queryParams: { scheduleId: 'sched-1' },
    });
  });

  it('restock posts to the embodiment restock endpoint and reloads', () => {
    apiMock.post.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    apiMock.get.mockClear();
    fixture.componentInstance.restock('emb-1');
    expect(apiMock.post).toHaveBeenCalledWith('/embodiments/emb-1/restock', {});
    expect(apiMock.get).toHaveBeenCalledWith('/dashboard');
  });

  it('renders active episodes, schedules, shopping list, and advisories', () => {
    apiMock.get.mockReturnValue(
      of({
        lastDoses: [],
        activeEpisodes: [
          {
            patientId: 'p1',
            patientName: 'Kiddo',
            episodeId: 'ep1',
            name: 'Fever',
            startedAt: 1700000000,
            lastObservationSummary: { observedAt: 1700000100, entries: [{ id: 'e1', type: 'temperature', metadata: {} }] },
            medications: [
              { medicationId: 'm1', medicationName: 'Ibuprofen', lastDoseAt: 1700000200, nextAllowedAt: 1700014600, isAtypicalLastDose: false },
            ],
          },
        ],
        upcomingSchedules: [
          { scheduleId: 's1', patientId: 'p1', label: 'Amoxicillin', type: 'medication_dose', episodeId: null, nextDueAt: 1700000000, overdue: true },
        ],
        shoppingList: [{ embodimentId: 'emb1', medicationId: 'm1', medicationName: 'ibuprofen', label: 'suspension', runningLowFlaggedAt: 1700000000 }],
        unacknowledgedAdvisories: [{ id: 'a1', patientId: 'p1', type: 'protocol_fired', severity: 'danger', sourceType: null, sourceId: null, contextType: null, contextId: null, payload: null, acknowledgedByUserId: null, acknowledgedAt: null, createdAt: 1700000000, updatedAt: 1700000000 }],
      }),
    );
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Fever');
    expect(text).toContain('Kiddo');
    expect(text).toContain('Ibuprofen'); // medicationName now resolved, not a bare id
    expect(text).toContain('Amoxicillin');
    expect(text).toContain('overdue');
    expect(text).toContain('ibuprofen');
  });

  describe('last doses strip', () => {
    const nowSec = () => Math.floor(Date.now() / 1000);

    it('renders a relative time and a countdown for a recent dose', () => {
      apiMock.get.mockReturnValue(
        of({
          ...emptyPayload,
          lastDoses: [
            {
              patientId: 'p1',
              patientName: 'Kiddo',
              doses: [
                {
                  medicationId: 'm1',
                  medicationName: 'Tylenol',
                  lastDoseAt: nowSec() - (2 * 3600 + 15 * 60),
                  nextAllowedAt: nowSec() + 6000,
                  isAtypicalLastDose: false,
                },
              ],
            },
          ],
        }),
      );
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Last doses');
      expect(text).toContain('Kiddo');
      expect(text).toContain('Tylenol');
      expect(text).toContain('2h 15m ago');
      expect(text).toContain('next dose in 1h 40m');
    });

    it('shows a confident negative for a patient with nothing in the window, and does not double up with the generic empty state', () => {
      apiMock.get.mockReturnValue(
        of({
          ...emptyPayload,
          lastDoses: [{ patientId: 'p1', patientName: 'Kiddo', doses: [] }],
        }),
      );
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Kiddo');
      expect(text).toContain('Nothing given in the last 24 hours.');
      expect(text).not.toContain('Nothing needs attention right now.');
    });

    it('reads "can give now" once nextAllowedAt has elapsed', () => {
      apiMock.get.mockReturnValue(
        of({
          ...emptyPayload,
          lastDoses: [
            {
              patientId: 'p1',
              patientName: 'Kiddo',
              doses: [
                {
                  medicationId: 'm1',
                  medicationName: 'Tylenol',
                  lastDoseAt: nowSec() - 5 * 3600,
                  nextAllowedAt: nowSec() - 60,
                  isAtypicalLastDose: false,
                },
              ],
            },
          ],
        }),
      );
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('can give now');
    });
  });

  it('shows a while-you-were-asleep card only for patients with a non-empty diff', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/dashboard') return of(emptyPayload);
      if (path === '/patients') {
        return of([
          { id: 'p1', fullName: 'Has News' },
          { id: 'p2', fullName: 'Nothing New' },
        ]);
      }
      if (path === '/patients/p1/whats-new') {
        return of({ since: 1700000000, events: [{ id: 'e1' }], advisoriesFired: [], nowDue: [] });
      }
      if (path === '/patients/p2/whats-new') {
        return of({ since: 1700000000, events: [], advisoriesFired: [], nowDue: [] });
      }
      return of(null);
    });
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.whatsNewSummaries().length).toBe(1);
    expect(comp.whatsNewSummaries()[0].patientName).toBe('Has News');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('While you were asleep');
    expect(text).toContain('Has News');
    expect(text).not.toContain('Nothing New');

    comp.goToWhatsNew('p1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'whats-new']);
  });
});
