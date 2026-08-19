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
    recentTemperatures: [],
    temperatureRanges: [],
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

      // The row deep-links to the journal, where the since-you-last-looked marker now lives.
      comp.goToJournal('p1');
      expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'journal']);
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

  it('keeps the catalogs off Home — they live under Manage now', () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).not.toContain('Medication catalog');
    expect(text).not.toContain('Analyte catalog');
    expect(text).not.toContain('New schedule');
    // The logging actions stay: they are the reason this screen exists.
    expect(text).toContain('Create observation');
    expect(text).toContain('Log intervention');
  });

  // The bimodal split (frontend.md → "Information architecture (v2)" → Home). The page's shape
  // follows the household's state; these tests pin which shape appears when.
  describe('bimodal home', () => {
    const nowSec = () => Math.floor(Date.now() / 1000);

    const episode = (over: Record<string, unknown> = {}) => ({
      patientId: 'p1',
      patientName: 'Ada',
      episodeId: 'ep1',
      name: 'Fever',
      startedAt: nowSec() - 2 * 86400 - 3600, // into the third day
      lastObservationSummary: null,
      medications: [],
      ...over,
    });

    const dose = (over: Record<string, unknown> = {}) => ({
      medicationId: 'm1',
      medicationName: 'Ibuprofen',
      lastDoseAt: nowSec() - 3600,
      nextAllowedAt: nowSec() + 6000,
      isAtypicalLastDose: false,
      ...over,
    });

    const render = (payload: Record<string, unknown>) => {
      apiMock.get.mockReturnValue(of({ ...emptyPayload, ...payload }));
      const fixture = TestBed.createComponent(DashboardPage);
      fixture.detectChanges();
      return fixture;
    };

    describe('quiet mode', () => {
      it('renders the quiet sections and no sick cards or night board', () => {
        const fixture = render({
          lastDoses: [{ patientId: 'p1', patientName: 'Ada', doses: [] }],
          upcomingSchedules: [
            {
              scheduleId: 's1',
              patientId: 'p1',
              label: 'Amoxicillin',
              type: 'medication_dose',
              episodeId: null,
              nextDueAt: nowSec() - 600,
              overdue: true,
            },
          ],
        });
        const comp = fixture.componentInstance;
        const text = fixture.nativeElement.textContent;

        expect(comp.isSickMode()).toBe(false);
        expect(comp.showNightBoard()).toBe(false);
        expect(text).not.toContain('Who can have what');
        expect(text).toContain('Last doses');
        expect(text).toContain('Nothing given in the last 24 hours.');
        expect(text).toContain('Upcoming');
        expect(fixture.nativeElement.querySelector('.sick-card')).toBeNull();
      });
    });

    describe('sick mode', () => {
      it('renders one sick card per sick patient, with the episode day count and the countdown as the hero', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          recentTemperatures: [{ patientId: 'p1', points: [] }],
        });
        const text = fixture.nativeElement.textContent;

        expect(fixture.componentInstance.isSickMode()).toBe(true);
        expect(fixture.nativeElement.querySelectorAll('.sick-card').length).toBe(1);
        expect(text).toContain('Ada');
        expect(text).toContain('Fever');
        expect(text).toContain('day 3');
        expect(text).toContain('Ibuprofen');
        // The countdown is the hero element, not a muted suffix on the medication name.
        expect(fixture.nativeElement.querySelector('.dose-hero').textContent.trim()).toBe('in 1h 40m');
      });

      it('reads "can give now" on the hero once next-allowed has elapsed', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose({ nextAllowedAt: nowSec() - 60 })] })],
        });
        const hero = fixture.nativeElement.querySelector('.dose-hero');
        expect(hero.textContent.trim()).toBe('can give now');
        expect(hero.classList).toContain('ready');
      });

      it('says so in words when no guideline supplied an interval — null is no guidance, not "cannot give"', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose({ nextAllowedAt: null })] })],
        });
        expect(fixture.nativeElement.querySelector('.dose-hero').textContent.trim()).toBe('no interval given');
      });

      it('merges the episode-agnostic lastDoses into the card — a dose logged with no episode still shows', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          lastDoses: [
            {
              patientId: 'p1',
              patientName: 'Ada',
              doses: [dose({ medicationId: 'm2', medicationName: 'Tylenol', nextAllowedAt: nowSec() + 60 })],
            },
          ],
        });
        const meds = fixture.componentInstance.sickCards()[0].medications;
        expect(meds.map((m: { medicationName: string }) => m.medicationName)).toEqual(['Tylenol', 'Ibuprofen']);
      });

      it('keeps the newer of two records of the same medication rather than showing it twice', () => {
        const stale = dose({ lastDoseAt: nowSec() - 7200, nextAllowedAt: nowSec() + 1200 });
        const fresh = dose({ lastDoseAt: nowSec() - 600, nextAllowedAt: nowSec() + 9000 });
        const fixture = render({
          activeEpisodes: [episode({ medications: [stale] })],
          lastDoses: [{ patientId: 'p1', patientName: 'Ada', doses: [fresh] }],
        });
        const meds = fixture.componentInstance.sickCards()[0].medications;
        expect(meds.length).toBe(1);
        expect(meds[0].lastDoseAt).toBe(fresh.lastDoseAt);
        expect(meds[0].nextAllowedAt).toBe(fresh.nextAllowedAt);
      });

      it('does not repeat a sick patient in the Last doses strip, but still lists quiet patients there', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          lastDoses: [
            { patientId: 'p1', patientName: 'Ada', doses: [dose()] },
            { patientId: 'p2', patientName: 'Bo', doses: [] },
          ],
        });
        const rows = fixture.componentInstance.quietLastDoses();
        expect(rows.map((r: { patientId: string }) => r.patientId)).toEqual(['p2']);
        // The confident negative survives the demotion — it is the answer, not a fallback.
        expect(fixture.nativeElement.textContent).toContain('Nothing given in the last 24 hours.');
      });

      it('renders a sparkline from recentTemperatures, and a confident negative without one', () => {
        const withTemps = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          recentTemperatures: [
            {
              patientId: 'p1',
              points: [
                { timestamp: nowSec() - 40 * 3600, valueC: 38.2 },
                { timestamp: nowSec() - 3600, valueC: 39.4 },
              ],
            },
          ],
        });
        const card = withTemps.componentInstance.sickCards()[0];
        expect(card.points.length).toBe(2);
        expect(card.polyline.split(' ').length).toBe(2);
        // Newer reading is hotter, so it plots higher on the canvas (smaller y).
        expect(card.points[1].y).toBeLessThan(card.points[0].y);
        expect(withTemps.nativeElement.querySelector('.spark')).not.toBeNull();
        expect(withTemps.nativeElement.textContent).toContain('39.4 °C');

        const without = render({ activeEpisodes: [episode({ medications: [dose()] })] });
        expect(without.nativeElement.querySelector('.spark')).toBeNull();
        expect(without.nativeElement.textContent).toContain('No temperature logged in the last 48 hours.');
      });

      it('scales the sparkline to include the bands, so a band the night never reached still shows', () => {
        // Every reading sits well above the band. Scaled to the readings alone the band would be
        // clipped off the chart entirely — which is the one reference the reader is checking
        // against (frontend.md → Home).
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          recentTemperatures: [
            {
              patientId: 'p1',
              points: [
                { timestamp: nowSec() - 4 * 3600, valueC: 39.0 },
                { timestamp: nowSec() - 3600, valueC: 39.4 },
              ],
            },
          ],
          temperatureRanges: [
            {
              patientId: 'p1',
              ranges: [
                { id: 'r1', kind: 'reference', label: 'Normal', low: 36.1, high: 37.2, refText: null, effectiveFrom: 0 },
              ],
            },
          ],
        });

        const card = fixture.componentInstance.sickCards()[0];
        expect(card.scaleLow).toBeLessThanOrEqual(36.1);
        expect(card.scaleHigh).toBeGreaterThanOrEqual(39.4);
        expect(card.bands.length).toBe(1);
        // Drawn, and named in words — the shading alone does not say 36.1–37.2.
        expect(fixture.nativeElement.querySelector('.spark-band')).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Normal 36.1–37.2 °C');
        expect(fixture.nativeElement.querySelector('.spark-scale').textContent).toContain(String(card.scaleHigh));
      });

      it('draws a scale but no band when the household has recorded none', () => {
        // The app never substitutes its own idea of normal at render time (P6).
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          recentTemperatures: [{ patientId: 'p1', points: [{ timestamp: nowSec() - 3600, valueC: 39.4 }] }],
          temperatureRanges: [{ patientId: 'p1', ranges: [] }],
        });

        const card = fixture.componentInstance.sickCards()[0];
        expect(card.bands).toEqual([]);
        expect(card.scaleHigh).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.spark-band')).toBeNull();
        expect(fixture.nativeElement.querySelector('.spark-scale')).not.toBeNull();
      });

      it('converts bands to the viewer\'s unit, so a °C band never draws over °F readings', () => {
        authMock.user.mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com', preferredTempUnit: 'F' });
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose()] })],
          recentTemperatures: [{ patientId: 'p1', points: [{ timestamp: nowSec() - 3600, valueC: 39.4 }] }],
          temperatureRanges: [
            {
              patientId: 'p1',
              ranges: [
                { id: 'r1', kind: 'reference', label: 'Normal', low: 36.1, high: 37.2, refText: null, effectiveFrom: 0 },
              ],
            },
          ],
        });

        const card = fixture.componentInstance.sickCards()[0];
        expect(card.bands[0].low).toBeCloseTo(97, 0);
        expect(card.bands[0].high).toBeCloseTo(99, 0);
      });

      it('offers Temp and Dose quick actions scoped to that patient', () => {
        const fixture = render({ activeEpisodes: [episode({ medications: [dose()] })] });
        const comp = fixture.componentInstance;

        comp.quickTemp('p1');
        expect(routerMock.navigate).toHaveBeenCalledWith(['/observations/new'], { queryParams: { patientId: 'p1' } });
        comp.quickDose('p1');
        expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions/new'], { queryParams: { patientId: 'p1' } });
      });

      it('drops the separate Active episodes list — the sick cards are that list now', () => {
        const fixture = render({ activeEpisodes: [episode({ medications: [dose()] })] });
        expect(fixture.nativeElement.textContent).not.toContain('Active episodes');
      });

      it('orders cards by the soonest next actionable moment, counting overdue schedules', () => {
        const fixture = render({
          activeEpisodes: [
            episode({ patientId: 'p1', patientName: 'Ada', medications: [dose({ nextAllowedAt: nowSec() + 9000 })] }),
            episode({
              patientId: 'p2',
              patientName: 'Bo',
              episodeId: 'ep2',
              medications: [dose({ nextAllowedAt: nowSec() + 1800 })],
            }),
            episode({ patientId: 'p3', patientName: 'Cy', episodeId: 'ep3', medications: [dose({ nextAllowedAt: null })] }),
          ],
          upcomingSchedules: [
            {
              scheduleId: 's1',
              patientId: 'p1',
              label: 'Overdue amoxicillin',
              type: 'medication_dose',
              episodeId: null,
              nextDueAt: nowSec() - 3600,
              overdue: true,
            },
          ],
        });
        expect(fixture.componentInstance.sickCards().map((c: { patientId: string }) => c.patientId)).toEqual([
          'p1', // most overdue schedule, even though its own next dose is furthest off
          'p2',
          'p3', // nothing actionable at all sorts last
        ]);
      });
    });

    // The identity color is a safety affordance, not decoration: with two children sick on the
    // same medication at different weight-based doses, it is the always-on guard against reading
    // the wrong card (frontend.md → "Patient identity").
    // The regression guard for the NG0100 that turned CI red intermittently on main. Angular's
    // dev-mode checkNoChanges pass re-renders immediately after the first pass; when the time
    // labels read the wall clock on each pass, a second boundary landing between the two flipped
    // "in 2h 30m" to "in 2h 29m" and threw. Production skips that pass, so the impurity showed up
    // as a flaky test rather than a visible bug — but the same state was not rendering the same
    // way twice, which is the actual defect.
    describe('render is pure with respect to the clock', () => {
      // A clock that jumps a full minute on every read. Under the fix nothing in the render path
      // reads it at all — the component snapshots once at load — so the two passes agree. Restore
      // the wall-clock reads and each pass lands in a different minute, which is the bug.
      const installGallopingClock = () => {
        const base = Date.now();
        let call = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => base + call++ * 60_000);
      };

      afterEach(() => jest.restoreAllMocks());

      it('does not throw NG0100 when the clock advances mid-render', () => {
        // Build the payload on the real clock first, so the fixture's timestamps stay sane.
        const payload = {
          ...emptyPayload,
          activeEpisodes: [episode({ medications: [dose({ nextAllowedAt: nowSec() + 9000 })] })],
          lastDoses: [{ patientId: 'p2', patientName: 'Bo', accentColor: 'rose', doses: [dose()] }],
        };
        installGallopingClock();

        apiMock.get.mockReturnValue(of(payload));
        const fixture = TestBed.createComponent(DashboardPage);
        expect(() => fixture.detectChanges()).not.toThrow();
        expect(() => fixture.detectChanges()).not.toThrow();
      });

      it('renders the same label twice for the same payload', () => {
        const fixture = render({
          activeEpisodes: [episode({ medications: [dose({ nextAllowedAt: nowSec() + 9000 })] })],
        });
        const read = () => fixture.nativeElement.querySelector('.dose-hero').textContent.trim();
        const first = read();
        fixture.detectChanges();
        expect(read()).toBe(first);
        // Not pinned to an exact string: the fixture is built a moment before the component
        // snapshots its clock, so "2h 30m" and "2h 29m" are both legitimate here. The property
        // under test is that whichever one it picks, it keeps.
        expect(first).toMatch(/^in \d+h \d+m$/);
      });
    });

    describe('accent colors', () => {
      it('carries the patient token on the sick card and the night-board row', () => {
        const fixture = render({
          activeEpisodes: [
            episode({ patientId: 'p1', patientName: 'Ada', accentColor: 'teal', medications: [dose()] }),
            episode({
              patientId: 'p2',
              patientName: 'Bo',
              episodeId: 'ep2',
              accentColor: 'amber',
              medications: [dose({ nextAllowedAt: nowSec() - 60 })],
            }),
          ],
        });

        const card = fixture.nativeElement.querySelector('.sick-card');
        expect(card.classList).toContain('accent-rail');
        const row = fixture.nativeElement.querySelector('.nb-row');
        expect(row.classList).toContain('accent-rail');
        // Bo sorts first (can give now), so both surfaces should be showing Bo's amber.
        expect(card.textContent).toContain('Bo');
        expect(card.classList).toContain('accent-amber');
        expect(row.classList).toContain('accent-amber');
      });

      it('gives two sick patients different tokens — the whole point of the color', () => {
        const fixture = render({
          activeEpisodes: [
            episode({ patientId: 'p1', patientName: 'Ada', accentColor: 'teal', medications: [dose()] }),
            episode({
              patientId: 'p2',
              patientName: 'Bo',
              episodeId: 'ep2',
              accentColor: 'amber',
              medications: [dose({ nextAllowedAt: nowSec() + 90000 })],
            }),
          ],
        });
        const classes = Array.from(fixture.nativeElement.querySelectorAll('.sick-card')).map((c: any) =>
          Array.from(c.classList).find((k: any) => k.startsWith('accent-') && k !== 'accent-rail'),
        );
        expect(classes).toEqual(['accent-teal', 'accent-amber']);
        expect(new Set(classes).size).toBe(2);
      });

      it('puts a dot beside every patient name it renders, cards and strips alike', () => {
        const fixture = render({
          activeEpisodes: [episode({ accentColor: 'violet', medications: [dose()] })],
          lastDoses: [{ patientId: 'p2', patientName: 'Bo', accentColor: 'rose', doses: [] }],
          whatsNew: [
            {
              patientId: 'p2',
              patientName: 'Bo',
              accentColor: 'rose',
              since: 1700000000,
              eventCount: 2,
              advisoryCount: 0,
              nowDueCount: 0,
            },
          ],
        });
        expect(fixture.nativeElement.querySelector('.sick-card .accent-dot')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.nb-patient, .sick-name')).not.toBeNull();

        const stripRow = fixture.nativeElement.querySelector('.dose-list li');
        expect(stripRow.classList).toContain('accent-rose');
        expect(stripRow.querySelector('.accent-dot')).not.toBeNull();

        const newsRow = fixture.nativeElement.querySelector('.schedule-list li');
        expect(newsRow.classList).toContain('accent-rose');
        expect(newsRow.querySelector('.accent-dot')).not.toBeNull();
      });

      it('degrades to no color rather than a wrong one when the token is absent', () => {
        const fixture = render({ activeEpisodes: [episode({ medications: [dose()] })] });
        const card = fixture.nativeElement.querySelector('.sick-card');
        const tokens = Array.from(card.classList).filter(
          (k: any) => k.startsWith('accent-') && k !== 'accent-rail',
        );
        expect(tokens).toEqual([]);
        expect(fixture.componentInstance.accentClass(undefined)).toBe('');
      });
    });

    describe('night board', () => {
      // A factory, not a constant: the relative-time labels are computed against the clock at render
      // time, and a payload built when the describe block was evaluated would drift a second or two
      // by the time a later test asserts on "in 1h 40m".
      const twoSick = () => ({
        activeEpisodes: [
          episode({
            patientId: 'p1',
            patientName: 'Ada',
            medications: [dose({ nextAllowedAt: nowSec() + 6000 })],
          }),
          episode({
            patientId: 'p2',
            patientName: 'Bo',
            episodeId: 'ep2',
            medications: [dose({ nextAllowedAt: nowSec() - 60, isAtypicalLastDose: true })],
          }),
        ],
      });

      it('stays hidden with a single sick patient — one child is just a card', () => {
        const fixture = render({ activeEpisodes: [episode({ medications: [dose()] })] });
        expect(fixture.componentInstance.showNightBoard()).toBe(false);
        expect(fixture.nativeElement.querySelector('.night-board')).toBeNull();
      });

      it('renders one row per sick patient with a countdown cell per medication', () => {
        const fixture = render(twoSick());
        expect(fixture.componentInstance.showNightBoard()).toBe(true);

        const rows = Array.from(fixture.nativeElement.querySelectorAll('.nb-row')) as HTMLElement[];
        expect(rows.length).toBe(2);
        // Bo can be dosed now, so Bo's row is first — the top of the screen is the next thing to do.
        expect(rows[0].querySelector('.nb-patient')!.textContent!.trim()).toBe('Bo');
        expect(rows[0].querySelector('.nb-count')!.textContent!.trim()).toBe('can give now');
        expect(rows[0].querySelector('.nb-count')!.classList).toContain('ready');
        expect(rows[0].textContent).toContain('atypical');

        expect(rows[1].querySelector('.nb-patient')!.textContent!.trim()).toBe('Ada');
        expect(rows[1].querySelector('.nb-count')!.textContent!.trim()).toBe('in 1h 40m');
        expect(rows[1].textContent).not.toContain('atypical');
      });

      it('renders above the sick cards, never interleaved with them', () => {
        const fixture = render(twoSick());
        const board = fixture.nativeElement.querySelector('.night-board-section');
        const cards = fixture.nativeElement.querySelector('.sick-cards');
        expect(board).not.toBeNull();
        expect(cards).not.toBeNull();
        // Node.DOCUMENT_POSITION_FOLLOWING — the cards section comes after the board.
        expect(board.compareDocumentPosition(cards) & 4).toBeTruthy();
      });

      it('lists a medication line per medication, not one per patient', () => {
        const fixture = render({
          activeEpisodes: [
            episode({
              patientId: 'p1',
              patientName: 'Ada',
              medications: [
                dose({ nextAllowedAt: nowSec() + 6000 }),
                dose({ medicationId: 'm2', medicationName: 'Tylenol', nextAllowedAt: nowSec() + 1800 }),
              ],
            }),
            episode({ patientId: 'p2', patientName: 'Bo', episodeId: 'ep2', medications: [dose()] }),
          ],
        });
        const rows = Array.from(fixture.nativeElement.querySelectorAll('.nb-row')) as HTMLElement[];
        const adaRow = rows.find((r) => r.textContent!.includes('Ada'))!;
        expect(adaRow.querySelectorAll('.nb-med').length).toBe(2);
        expect(adaRow.textContent).toContain('Tylenol');
        expect(adaRow.textContent).toContain('Ibuprofen');
      });
    });
  });
});
