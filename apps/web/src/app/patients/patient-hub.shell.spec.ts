import { Component, OnInit, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PatientHubShell } from './patient-hub.shell';
import { PatientHubStore } from './patient-hub.store';
import { AuthService } from '../core/auth.service';
import { ApiClientService } from '../core/api-client.service';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * A birth date exactly six years before the 1st of the current month, as a local `YYYY-MM-DD`.
 * The age is computed against the real clock, so a fixed date of birth made the age assertion
 * rot as the months passed. Anchoring on the 1st keeps it at a whole "6y" on every day of the
 * month (and sidesteps Feb 29 having no counterpart six years back).
 */
const sixYearsAgo = () => {
  const now = new Date();
  const y = now.getFullYear() - 6;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
};

const patient = {
  id: 'p1',
  fullName: 'Jamie Doe',
  dateOfBirth: sixYearsAgo(),
  sexAtBirth: 'female',
  notes: null,
  ownedById: 'u1',
  accentColor: 'violet',
  latestWeightKg: 18,
  latestWeightRecordedAt: nowSeconds() - 5 * 86400,
  myRole: 'parent',
  codeStatus: null,
  codeStatusSetByUserId: null,
  codeStatusSetAt: null,
};

/** An ActivatedRoute stand-in whose `:id` can change under a live shell, as a sidebar click does. */
const routeFor = (id: string | null) => {
  const paramMap = new BehaviorSubject<ParamMap>(convertToParamMap(id ? { id } : {}));
  return { paramMap, snapshot: { paramMap: paramMap.value } };
};

describe('PatientHubShell', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  const build = () => {
    const fixture = TestBed.createComponent(PatientHubShell);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    // Switch on path, not call order: ngOnInit fans out to three endpoints and a
    // mockReturnValueOnce chain breaks the moment a fourth is added.
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path === '/patients/p1') return of(patient);
        if (path === '/patients/p1/reactions') return of([]);
        if (path === '/patients/p1/episodes') return of([]);
        return of([]);
      }),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    // routerLink/routerLinkActive on the tab strip drive real directives, so the mock needs the
    // members they touch — a bare { navigate } mock makes RouterLinkActive throw on construction.
    routerMock = {
      navigate: jest.fn(),
      navigateByUrl: jest.fn(),
      events: new Subject(),
      createUrlTree: jest.fn().mockReturnValue({}),
      serializeUrl: jest.fn().mockReturnValue('/'),
      isActive: jest.fn().mockReturnValue(false),
    };

    await TestBed.configureTestingModule({
      imports: [PatientHubShell],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeFor('p1') },
      ],
    }).compileComponents();
  });

  it('loads the patient once for the whole hub', () => {
    const fixture = build();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/reactions');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes', { status: 'active' });
    expect(fixture.nativeElement.textContent).toContain('Jamie Doe');
  });

  it('names the care-team tab for what it manages and labels the settings gear', () => {
    // The regression this fixes: "Share" and a bare glyph left patient and relationship management
    // unfindable after the v1 page was split into tabs.
    const fixture = build();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.tab-link')).map((a: any) =>
      a.textContent.trim(),
    );
    expect(tabs).toContain('Care team');
    expect(tabs.some((t: string) => t.includes('Settings'))).toBe(true);
    expect(tabs).not.toContain('Share');
  });

  it('reaches the photo progression view from the tab strip', () => {
    // Photos live inside observations; without a tab of their own the only way to a site's
    // progression is scrolling the journal (frontend.md → Photos → "Photos by site").
    const fixture = build();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.tab-link')).map((a: any) =>
      a.textContent.trim(),
    );
    expect(tabs).toContain('Photos');
  });

  it('offers the ER Brief from the header, so it is reachable from every tab', () => {
    const fixture = build();
    fixture.componentInstance.goToErBrief();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'er-brief']);
  });

  it('shows the age alongside the name', () => {
    const fixture = build();
    expect(fixture.componentInstance.age()).toBe('6y');
  });

  it('pins danger reactions in the header, not warnings', () => {
    // A danger-class reaction has to be visible from every tab — it is what fires the interstitial
    // at dose entry, and the ER Brief treats allergies as header material.
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/patients/p1') return of(patient);
      if (path === '/patients/p1/reactions')
        return of([
          { id: 'r1', severity: 'danger', description: 'throat swelling' },
          { id: 'r2', severity: 'warning', description: 'mild rash' },
        ]);
      return of([]);
    });
    const fixture = build();
    expect(fixture.componentInstance['store'].dangerReactions().length).toBe(1);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('throat swelling');
    expect(text).not.toContain('mild rash');
  });

  it('flags a stale weight and stays quiet about a fresh one', () => {
    const fresh = build();
    expect(fresh.componentInstance.weightStale()).toBe(false);

    TestBed.resetTestingModule();
    apiMock.get.mockImplementation((path: string) =>
      path === '/patients/p1' ? of({ ...patient, latestWeightRecordedAt: null }) : of([]),
    );
    // Rebuild against the same providers with the stale patient.
    TestBed.configureTestingModule({
      imports: [PatientHubShell],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeFor('p1') },
      ],
    });
    const stale = TestBed.createComponent(PatientHubShell);
    stale.detectChanges();
    expect(stale.componentInstance.weightStale()).toBe(true);
    expect(stale.nativeElement.textContent).toContain('weight never recorded');
  });

  it('carries the patient accent color in the header', () => {
    const fixture = build();
    expect(fixture.componentInstance.accentClass()).toBe('accent-violet');
    const header = fixture.nativeElement.querySelector('.hub-header');
    expect(header.classList).toContain('accent-violet');
    expect(header.classList).toContain('accent-rail');
    expect(fixture.nativeElement.querySelector('.accent-dot')).toBeTruthy();
  });

  it('leaves the header neutral until the patient resolves', () => {
    // No class at all rather than a guessed one: a color that changes once the payload lands is
    // the opposite of the stable identity cue this is for.
    const fixture = build();
    fixture.componentInstance['store'].patient.set(null);
    expect(fixture.componentInstance.accentClass()).toBe('');
  });

  it('sends a request with no patient id back to the list', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatientHubShell],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeFor(null) },
      ],
    });
    const fixture = TestBed.createComponent(PatientHubShell);
    fixture.detectChanges();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/patients');
  });

  describe('switching patients in place', () => {
    // frontend.md → "Patient identity". A sidebar click from one patient's hub to another's changes
    // only `:id`, and Angular reuses the shell for it. The bug this covers: the shell read `:id`
    // once, so the header — and every tab, through the store — went on showing the sibling.
    const sibling = { ...patient, id: 'p2', fullName: 'Sam Doe', accentColor: 'teal', sexAtBirth: 'male' };
    let route: ReturnType<typeof routeFor>;
    let responses: Record<string, Subject<any>>;

    beforeEach(() => {
      TestBed.resetTestingModule();
      route = routeFor('p1');
      responses = {};
      // Each GET answers only when the test says so, which is what lets it play responses out of order.
      apiMock.get.mockImplementation((path: string) => (responses[path] ??= new Subject<any>()));
      TestBed.configureTestingModule({
        imports: [PatientHubShell],
        providers: [
          PatientHubStore,
          { provide: ApiClientService, useValue: apiMock },
          { provide: AuthService, useValue: authMock },
          { provide: Router, useValue: routerMock },
          { provide: ActivatedRoute, useValue: route },
        ],
      });
    });

    const answer = (path: string, body: any) => responses[path].next(body);
    const header = (fixture: any) => fixture.nativeElement.querySelector('.hub-header').textContent;

    it('follows the route to the new patient: requests, header, accent and ER Brief', () => {
      const fixture = build();
      answer('/patients/p1', patient);
      answer('/patients/p1/episodes', [{ id: 'e1', name: 'Jamie flu' }]);
      fixture.detectChanges();
      expect(header(fixture)).toContain('Jamie flu');

      route.paramMap.next(convertToParamMap({ id: 'p2' }));
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p2');
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p2/reactions');
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p2/episodes', { status: 'active' });
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p2/care-team');
      answer('/patients/p2', sibling);
      fixture.detectChanges();

      expect(header(fixture)).toContain('Sam Doe');
      expect(header(fixture)).toContain('male');
      expect(header(fixture)).not.toContain('Jamie');
      expect(fixture.componentInstance.accentClass()).toBe('accent-teal');
      fixture.componentInstance.goToErBrief();
      expect(routerMock.navigate).toHaveBeenLastCalledWith(['/patients', 'p2', 'er-brief']);
    });

    it("clears the previous patient's header the moment the id changes, before the new one loads", () => {
      const fixture = build();
      answer('/patients/p1', patient);
      answer('/patients/p1/episodes', [{ id: 'e1', name: 'Jamie flu' }]);
      fixture.detectChanges();

      route.paramMap.next(convertToParamMap({ id: 'p2' }));
      fixture.detectChanges();
      // Nothing for p2 has answered yet: the header must be blank, not still Jamie's.
      const text = header(fixture);
      expect(text).not.toContain('Jamie');
      expect(text).not.toContain('Jamie flu');
      expect(text).not.toContain('6y');
      expect(fixture.componentInstance.accentClass()).toBe('');
      expect(fixture.componentInstance.weightStale()).toBe(false);
    });

    it('ignores a late response for the previous patient', () => {
      // Click A, then B quickly; A's answers arrive last.
      const fixture = build();
      route.paramMap.next(convertToParamMap({ id: 'p2' }));
      answer('/patients/p2', sibling);
      answer('/patients/p2/episodes', []);
      answer('/patients/p1', patient);
      answer('/patients/p1/episodes', [{ id: 'e1', name: 'Jamie flu' }]);
      answer('/patients/p1/reactions', [{ id: 'r1', severity: 'danger', description: 'throat swelling' }]);
      fixture.detectChanges();

      const store = fixture.componentInstance['store'] as PatientHubStore;
      expect(store.patient()?.id).toBe('p2');
      expect(store.activeEpisodes()).toEqual([]);
      expect(store.reactions()).toEqual([]);
      expect(header(fixture)).toContain('Sam Doe');
      expect(header(fixture)).not.toContain('Jamie');
      expect(header(fixture)).not.toContain('throat swelling');
    });
  });
});

/** A hub tab stand-in that records which patient it loaded for, the way the real tabs do in ngOnInit. */
@Component({ standalone: true, template: `tab for {{ loadedFor }}` })
class RecordingTab implements OnInit {
  static loads: string[] = [];
  private readonly store = inject(PatientHubStore);
  loadedFor = '';
  ngOnInit() {
    this.loadedFor = this.store.patientId();
    RecordingTab.loads.push(this.loadedFor);
  }
}

describe('PatientHubShell under the real router', () => {
  // The unit tests above stub the route; this one drives real navigation, because the failure was
  // the router *reusing* the shell and its active tab when only `:id` changed.
  const people: Record<string, any> = {
    p1: { ...patient, id: 'p1', fullName: 'Jamie Doe' },
    p2: { ...patient, id: 'p2', fullName: 'Sam Doe' },
  };

  beforeEach(() => {
    RecordingTab.loads = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: 'patients/:id',
              component: PatientHubShell,
              providers: [PatientHubStore],
              children: [{ path: 'journal', component: RecordingTab }],
            },
          ],
          withRouterConfig({ paramsInheritanceStrategy: 'always' })
        ),
        {
          provide: ApiClientService,
          useValue: { get: jest.fn((path: string) => of(people[path.split('/')[2]] && path.split('/').length === 3 ? people[path.split('/')[2]] : [])) },
        },
        {
          provide: AuthService,
          useValue: { token: 't', user: () => ({ id: 'u1' }), me: jest.fn(), logout: jest.fn() },
        },
      ],
    });
  });

  it('rebuilds the active tab for the new patient on a sidebar-style switch', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/patients/p1/journal');
    expect(harness.routeNativeElement?.textContent).toContain('Jamie Doe');
    expect(harness.routeNativeElement?.textContent).toContain('tab for p1');

    await harness.navigateByUrl('/patients/p2/journal');
    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain('Sam Doe');
    expect(text).toContain('tab for p2');
    expect(text).not.toContain('Jamie');
    expect(text).not.toContain('tab for p1');
    // The tab ran its loads again, for p2 — not reused with p1's.
    expect(RecordingTab.loads).toEqual(['p1', 'p2']);
  });
});
