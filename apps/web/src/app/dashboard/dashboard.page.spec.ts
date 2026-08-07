import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
    whatsNew: [],
    activeEpisodes: [],
    upcomingSchedules: [],
    shoppingList: [],
    unacknowledgedAdvisories: [],
  };

  beforeEach(async () => {
    apiMock = {
      // Answers /dashboard and nothing else. A path-blind mockReturnValue used to hand the dashboard
      // payload to every url, which is how the whats-new fan-out went untested for so long — the
      // page asked /patients, got an object, read `.length` as undefined, and silently bailed. Any
      // stray request now fails loudly instead of being quietly satisfied.
      get: jest.fn().mockImplementation((path: string) =>
        path === '/dashboard' ? of(emptyPayload) : throwError(() => new Error(`unexpected GET ${path}`)),
      ),
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

  it('navigates to the episode detail page', () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    fixture.componentInstance.goToEpisode('ep1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
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

  describe('while you were asleep', () => {
    const summary = (over: Record<string, unknown>) => ({
      patientId: 'p1',
      patientName: 'Kiddo',
      since: 1700000000,
      eventCount: 0,
      advisoryCount: 0,
      nowDueCount: 0,
      ...over,
    });

    it('renders a card only for patients with a non-empty diff — the server sends all-zero rows too', () => {
      apiMock.get.mockReturnValue(
        of({
          ...emptyPayload,
          whatsNew: [
            summary({ patientId: 'p1', patientName: 'Has News', eventCount: 1 }),
            summary({ patientId: 'p2', patientName: 'Nothing New' }),
          ],
        }),
      );
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

    // The regression guard for ISSUES.md #10: the counts used to cost GET /patients plus one
    // GET /patients/:id/whats-new per patient on top of the dashboard request.
    it('reads the counts off the dashboard payload instead of fanning out per patient', () => {
      apiMock.get.mockReturnValue(of({ ...emptyPayload, whatsNew: [summary({ eventCount: 3 })] }));
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();

      expect(apiMock.get).toHaveBeenCalledTimes(1);
      expect(apiMock.get).toHaveBeenCalledWith('/dashboard');
      expect(apiMock.get).not.toHaveBeenCalledWith('/patients');
    });

    it('pluralizes each clause and joins them with separators', () => {
      apiMock.get.mockReturnValue(
        of({
          ...emptyPayload,
          whatsNew: [summary({ eventCount: 1, advisoryCount: 2, nowDueCount: 1 })],
        }),
      );
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

      expect(text).toContain('1 new event ·');
      expect(text).not.toContain('1 new events');
      expect(text).toContain('2 advisories fired ·');
      expect(text).toContain('1 due now');
    });

    it('omits a zero clause entirely rather than reading "0 new events"', () => {
      apiMock.get.mockReturnValue(
        of({ ...emptyPayload, whatsNew: [summary({ eventCount: 0, advisoryCount: 1 })] }),
      );
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;

      expect(text).toContain('1 advisory fired');
      expect(text).not.toContain('0 new event');
    });
  });

  it('surfaces a message when the dashboard fails to load, rather than rendering blank', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.dashboard()).toBeNull();
    expect(comp.error()).toBe('Could not load the dashboard.');
    expect(fixture.nativeElement.textContent).toContain('Could not load the dashboard.');
  });

  it('surfaces a message when restock fails', () => {
    apiMock.post.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    fixture.componentInstance.restock('emb-1');

    expect(fixture.componentInstance.error()).toBe('Could not mark that as restocked.');
  });
});
