import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ErBriefPage } from './er-brief.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const baseBrief = {
  header: {
    patient: { id: 'p1', fullName: 'Milo M5', dateOfBirth: '2016-05-01', sexAtBirth: 'male', ageYears: 9, ageMonths: 112 },
    latestWeight: { kg: 24.3, recordedAt: 1700000000 },
    codeStatus: { value: 'Full code', setByUserId: 'u1', setByName: 'Tester', setAt: 1700000000 },
    dangerReactions: [],
    activeConditions: [],
    protocolFiredReason: null,
  },
  body: {
    eventScope: { type: 'episode', episodeId: 'ep1' },
    episode: { id: 'ep1', name: 'Fever', status: 'active', startedAt: 1700000000, endedAt: null },
    events: [],
    activeSchedules: [],
    priorEpisodes: [],
    atypicalAdvisories: [],
  },
};

describe('ErBriefPage', () => {
  let apiMock: any;
  let routerMock: any;
  let routeMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn((path: string) => (path.endsWith('/snapshots') ? of([]) : of(baseBrief))),
      post: jest.fn(),
      delete: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };
    routeMock = {
      snapshot: {
        paramMap: new Map([['id', 'p1']]),
        queryParamMap: { get: () => null },
      },
    };

    await TestBed.configureTestingModule({
      imports: [ErBriefPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();
  });

  it('loads the brief for the patient', () => {
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/er-brief', {});
    expect(fixture.componentInstance.brief()?.header.patient.fullName).toBe('Milo M5');
  });

  it('shows an error when the brief fails to load', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Unable to load the ER Brief.');
  });

  it('creates a shareable link', () => {
    apiMock.post.mockReturnValue(of({ token: 'tok123', url: 'http://x/brief/tok123', expiresAt: 1700100000 }));
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.createLink();
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/er-brief/snapshots', { episodeId: 'ep1' });
    expect(comp.snapshot()?.token).toBe('tok123');
  });

  it('toggles flash mode', () => {
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.isFlash()).toBe(false);
    comp.toggleFlash();
    expect(comp.isFlash()).toBe(true);
  });

  it('lists existing snapshots and revokes one', () => {
    apiMock.get.mockImplementation((path: string) =>
      path.endsWith('/snapshots')
        ? of([{ id: 'snap1', episodeId: 'ep1', createdByUserId: 'u1', createdAt: 1700000000, expiresAt: 1700100000 }])
        : of(baseBrief),
    );
    apiMock.delete.mockReturnValue(of({ deleted: true }));
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.snapshots().length).toBe(1);
    comp.revokeSnapshot('snap1');
    expect(apiMock.delete).toHaveBeenCalledWith('/er-brief/snapshots/snap1');
    expect(comp.snapshots().length).toBe(0);
  });

  it('backToPatient navigates to the patient detail page', () => {
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    fixture.componentInstance.backToPatient();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1']);
  });

  it('goToEpisode navigates to the episode detail page for a prior episode', () => {
    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    fixture.componentInstance.goToEpisode('ep-prior');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep-prior']);
  });
  it('names the window and swaps the headings when no episode is open', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/snapshots')) return of([]);
      return of({
        ...baseBrief,
        body: {
          ...baseBrief.body,
          eventScope: { type: 'recent', windowHours: 72, since: 1700000000, generatedAt: 1700259200 },
          episode: null,
          priorEpisodes: [{ id: 'ep0', name: 'Old fever', status: 'resolved', startedAt: 1600000000, endedAt: 1600100000 }],
        },
      });
    });

    const fixture = TestBed.createComponent(ErBriefPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    // A confident negative naming the actual window, rather than a blank section.
    expect(text).toContain('No open episode');
    expect(text).toContain('last 72 hours');
    expect(text).toContain('Nothing logged in the last 72 hours.');
    // Headings follow the scope: there is no condition to say "under this condition" about.
    expect(text).toContain('Recent episodes');
    expect(text).not.toContain('Prior episodes under this condition');
  });
});
