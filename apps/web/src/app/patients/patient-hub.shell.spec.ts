import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { PatientHubShell } from './patient-hub.shell';
import { PatientHubStore } from './patient-hub.store';
import { AuthService } from '../core/auth.service';
import { ApiClientService } from '../core/api-client.service';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const patient = {
  id: 'p1',
  fullName: 'Jamie Doe',
  dateOfBirth: '2020-08-19',
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map() } } },
      ],
    });
    const fixture = TestBed.createComponent(PatientHubShell);
    fixture.detectChanges();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/patients');
  });
});
