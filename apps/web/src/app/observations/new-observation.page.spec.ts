import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewObservationPage } from './new-observation.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('NewObservationPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let routeMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of([])),
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigateByUrl: jest.fn(), navigate: jest.fn() };
    routeMock = { snapshot: { queryParamMap: new Map() } };

    await TestBed.configureTestingModule({
      imports: [NewObservationPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();
  });

  it('loads patients and creates observation', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/episodes')) {
        return of([{ id: 'ep1', name: 'Episode 1' }]);
      }
      return of([
        {
          id: 'p1',
          fullName: 'Pat',
          dateOfBirth: '2020-01-01',
          sexAtBirth: 'female',
          notes: null,
          ownedById: 'u1',
          latestWeightKg: null,
          latestWeightRecordedAt: null,
          myRole: 'parent',
        },
      ]);
    });
    apiMock.post.mockReturnValue(of({}));

    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({
      patientId: 'p1',
      observedAt: '2025-01-01T10:00',
      episodeSelection: ['ep1'],
      resolveSelected: true,
    });
    comp.addEntry({ type: 'temperature', metadata: { value: 37.5, unit: 'C', method: 'oral' } });
    comp.submit();
    expect(apiMock.post).toHaveBeenCalled();
    const [path, payload] = apiMock.post.mock.calls[0];
    expect(path).toBe('/patients/p1/observations');
    expect(payload.entries).toEqual([
      { type: 'temperature', metadata: { value: 37.5, unit: 'C', method: 'oral' } },
    ]);
  });

  it('stamps the caregiver unit preferences onto the payload', () => {
    apiMock.get.mockReturnValue(of([]));
    apiMock.post.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', observedAt: '2025-01-01T10:00' });
    comp.addEntry({ type: 'heart_rate', metadata: { bpm: 120 } });
    comp.submit();
    expect(apiMock.post.mock.calls[0][1].unitPreferenceAtEntry).toEqual({
      temp: 'F',
      weight: 'kg',
      length: 'cm',
    });
  });

  it('handles api error', () => {
    apiMock.get.mockReturnValue(of([]));
    apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', observedAt: '2025-01-01T10:00' });
    comp.addEntry({ type: 'note', metadata: { text: 'hi' } });
    comp.submit();
    expect(comp.error()).toBe('Could not save observation.');
  });

  it('renders a human summary per entry, in the caregiver preferred units, rather than raw JSON', () => {
    // authMock (top of file) prefers F/cm/kg — everything below reflects that, via the shared
    // core/event-display formatter (also used by whats-new, er-brief, and shared-brief).
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.entrySummary({ type: 'temperature', metadata: { value: 38.1, unit: 'F', method: 'oral' } })).toBe(
      'Temp 38.1 °F (oral)',
    );
    expect(comp.entrySummary({ type: 'heart_rate', metadata: { bpm: 120 } })).toBe('HR 120 bpm');
    expect(comp.entrySummary({ type: 'oxygen_saturation', metadata: { percent: 97 } })).toBe('SpO2 97%');
    expect(comp.entrySummary({ type: 'pain_score', metadata: { score: 7 } })).toBe('Pain 7/10');
    expect(comp.entrySummary({ type: 'weight', metadata: { kg: 11.34 } })).toBe('11.34 kg');
    expect(
      comp.entrySummary({
        type: 'lesion_size',
        metadata: { lengthCm: 2, widthCm: 1.5, depthCm: null, bodyLocation: 'left forearm', side: 'left' },
      }),
    ).toBe('2 × 1.5 cm · left forearm (left)');
    expect(comp.entrySummary({ type: 'symptom', metadata: { tag: 'cough', severity: 'moderate' } })).toBe(
      'cough — moderate',
    );
    expect(comp.entrySummary({ type: 'tag', metadata: { tag: 'cough' } })).toBe('#cough');

    comp.addEntry({ type: 'heart_rate', metadata: { bpm: 120 } });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('HR 120 bpm');
    expect(text).not.toContain('"bpm"');
  });

  it('converts a temperature recorded in Celsius to the caregiver F preference', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.entrySummary({ type: 'temperature', metadata: { value: 38.4, unit: 'C', method: 'rectal' } })).toBe(
      'Temp 101.1 °F (rectal)',
    );
  });

  it('shows the protocol card instead of navigating away when a protocol fires', () => {
    apiMock.get.mockReturnValue(of([]));
    apiMock.post.mockReturnValue(
      of({
        id: 'obs-1',
        firedAdvisories: [
          {
            id: 'adv-1',
            patientId: 'p1',
            type: 'protocol_fired',
            severity: 'danger',
            sourceType: 'protocol',
            sourceId: 'proto-1',
            contextType: 'observation',
            contextId: 'obs-1',
            payload: {
              protocolName: 'Fever with port',
              instructionText: 'ER immediately, do not give antipyretics first',
              sourceText: 'Dr. Okafor, 2026-03-01',
              conditionName: 'ALL treatment',
              triggerMetric: 'temperature',
              triggerOperator: 'gte',
              triggerValue: 38,
              observedValue: 38.3,
            },
            acknowledgedByUserId: 'u1',
            acknowledgedAt: 1700000000,
            createdAt: 1700000000,
            updatedAt: 1700000000,
          },
        ],
      }),
    );
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', observedAt: '2025-01-01T10:00' });
    comp.addEntry({ type: 'temperature', metadata: { value: 38.3, unit: 'C', method: 'oral' } });
    comp.submit();

    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    expect(comp.firedAdvisories().length).toBe(1);

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Fever with port');
    expect(text).toContain('ER immediately, do not give antipyretics first');

    comp.continueToDashboard();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a framing hint from the most recent photo entry in the selected episode', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/timeline')) {
        return of({
          patient: { id: 'p1' },
          weightPrompt: { needsUpdate: false, lastRecordedAt: null, daysSince: null },
          entries: [
            {
              id: 'obs-1',
              kind: 'observation',
              type: 'photo',
              timestamp: 1700000000,
              display: { entries: [{ type: 'photo', metadata: { fileId: 'old-file' } }] },
            },
          ],
        });
      }
      return of([]);
    });
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', episodeSelection: ['ep1'] });
    comp.onEntryTypeChange('photo');

    expect(comp.framingHintFileId()).toBe('old-file');
  });

  it('prefills the patient and pre-checks the episode to resolve, arriving from episode-detail\'s "Resolve" action', () => {
    routeMock.snapshot.queryParamMap = new Map([
      ['patientId', 'p1'],
      ['resolveEpisodeId', 'ep1'],
    ]);
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/episodes')) return of([{ id: 'ep1', name: 'Rash watch' }]);
      if (path === '/patients') return of([{ id: 'p1', fullName: 'Kiddo' }]);
      return of([]);
    });
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.form.getRawValue().patientId).toBe('p1');
    expect(comp.form.getRawValue().episodeSelection).toEqual(['ep1']);
    expect(comp.form.getRawValue().resolveSelected).toBe(true);
    expect(comp.selectedEpisodeIds()).toEqual(['ep1']);
  });

  it('ignores a resolveEpisodeId that is not among the patient\'s active episodes', () => {
    routeMock.snapshot.queryParamMap = new Map([
      ['patientId', 'p1'],
      ['resolveEpisodeId', 'stale-episode'],
    ]);
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/episodes')) return of([{ id: 'ep1', name: 'Rash watch' }]);
      if (path === '/patients') return of([{ id: 'p1', fullName: 'Kiddo' }]);
      return of([]);
    });
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    // The stale id is dropped; what remains is the ordinary single-active-episode default, which
    // attaches but does NOT resolve — resolution is never inferred (P5).
    expect(comp.selectedEpisodeIds()).toEqual(['ep1']);
    expect(comp.form.getRawValue().resolveSelected).toBe(false);
  });

  // frontend.md → "Information architecture (v2)" → Quick Log: a visible default, never a silent
  // inference.
  describe('episode attachment', () => {
    function renderWithEpisodes(episodes: Array<{ id: string; name: string }>) {
      routeMock.snapshot.queryParamMap = new Map([['patientId', 'p1']]);
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/episodes')) return of(episodes);
        if (path === '/patients') return of([{ id: 'p1', fullName: 'Kiddo' }]);
        return of([]);
      });
      const fixture = TestBed.createComponent(NewObservationPage);
      fixture.detectChanges();
      return fixture;
    }

    it('pre-attaches the one active episode as a removable chip — zero taps', () => {
      const fixture = renderWithEpisodes([{ id: 'ep1', name: 'Fever – Aug 2026' }]);
      expect(fixture.componentInstance.selectedEpisodeIds()).toEqual(['ep1']);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Adding to');
      expect(text).toContain('Fever – Aug 2026');
    });

    it('pre-selects nothing when more than one episode is active', () => {
      const fixture = renderWithEpisodes([
        { id: 'ep1', name: 'Fever' },
        { id: 'ep2', name: 'Ear infection' },
      ]);
      expect(fixture.componentInstance.selectedEpisodeIds()).toEqual([]);
    });

    it('lets the caregiver reject the default before saving', () => {
      const fixture = renderWithEpisodes([{ id: 'ep1', name: 'Fever' }]);
      const remove: HTMLButtonElement = fixture.nativeElement.querySelector('.chip-remove');
      remove.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedEpisodeIds()).toEqual([]);
      expect(fixture.componentInstance.form.getRawValue().episodeSelection).toEqual([]);
    });
  });

  // frontend.md → Quick Log: each verb lands in this same form with the type pre-selected.
  describe('quick-log handoff', () => {
    function renderCompact(entryType: string, extraParams: Record<string, string> = {}) {
      routeMock.snapshot.queryParamMap = new Map([
        ['patientId', 'p1'],
        ['entryType', entryType],
        ['compact', '1'],
        ...Object.entries(extraParams),
      ]);
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/episodes')) return of([]);
        if (path === '/patients') return of([{ id: 'p1', fullName: 'Kiddo' }]);
        return of([]);
      });
      const fixture = TestBed.createComponent(NewObservationPage);
      fixture.detectChanges();
      return fixture;
    }

    it('renders a compact single-purpose layout with the patient pinned and no type picker', () => {
      const fixture = renderCompact('temperature');
      const el = fixture.nativeElement as HTMLElement;

      expect(fixture.componentInstance.lockedEntryType()).toBe('temperature');
      expect(el.querySelector('h1')?.textContent).toContain('Log temperature');
      expect(el.querySelector('.for-patient-name')?.textContent).toContain('Kiddo');
      // The patient dropdown is gone; the entry-type dropdown with it.
      expect(el.querySelector('select[formControlName="patientId"]')).toBeNull();
      expect(el.querySelector('select[name="entryType"]')).toBeNull();
    });

    it('names the patient on the save button, never a bare "Save"', () => {
      const fixture = renderCompact('pain_score');
      const save = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]');
      expect(save?.textContent?.trim()).toBe('Save for Kiddo');
    });

    it('ignores an entryType it does not offer as a verb', () => {
      const fixture = renderCompact('lab_result');
      expect(fixture.componentInstance.lockedEntryType()).toBeNull();
    });

    // Home's Temp quick action passes the patient's habitual method
    // (api.md → GET /api/dashboard → recentTemperatures.lastMethod).
    it('seeds the temperature method from the ?method param', () => {
      const fixture = renderCompact('temperature', { method: 'tympanic' });
      expect(fixture.componentInstance.initialTempMethod()).toBe('tympanic');
    });

    it('ignores a method that is not in the enum, and never prefills unknown', () => {
      expect(renderCompact('temperature', { method: 'telepathy' }).componentInstance.initialTempMethod()).toBeNull();
      expect(renderCompact('temperature', { method: 'unknown' }).componentInstance.initialTempMethod()).toBeNull();
    });
  });
});
