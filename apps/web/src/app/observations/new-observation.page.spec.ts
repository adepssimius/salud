import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EntryMetadataFormComponent } from './entry-metadata-form.component';
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

  // frontend.md → Photos, F-8.2 v2: one framing reference per photographed site, not one per
  // episode — a right ear and a left ear logged in the same observation are different series.
  it('builds one framing reference group per (bodyLocation, side), newest-first with counts', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/timeline')) {
        return of({
          patient: { id: 'p1' },
          weightPrompt: { needsUpdate: false, lastRecordedAt: null, daysSince: null },
          entries: [
            {
              id: 'obs-2',
              kind: 'observation',
              type: 'photo',
              timestamp: 1700000100,
              display: {
                entries: [
                  { type: 'photo', metadata: { fileId: 'right-new', bodyLocation: 'ear drum', side: 'right' } },
                  { type: 'photo', metadata: { fileId: 'left-only', bodyLocation: 'ear drum', side: 'left' } },
                ],
              },
            },
            {
              id: 'obs-1',
              kind: 'observation',
              type: 'photo',
              timestamp: 1700000000,
              display: {
                // Different casing/whitespace, same site: groups with obs-2's right-ear photo.
                entries: [{ type: 'photo', metadata: { fileId: 'right-old', bodyLocation: ' Ear Drum ', side: 'right' } }],
              },
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

    expect(comp.framingReferences()).toEqual([
      { bodyLocation: 'ear drum', side: 'right', fileId: 'right-new', timestamp: 1700000100, count: 2 },
      { bodyLocation: 'ear drum', side: 'left', fileId: 'left-only', timestamp: 1700000100, count: 1 },
    ]);
  });

  it('clears the framing references when no episode is selected', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.framingReferences.set([
      { bodyLocation: 'ear drum', side: 'right', fileId: 'f1', timestamp: 1700000000, count: 1 },
    ]);
    comp.form.patchValue({ patientId: 'p1', episodeSelection: [] });
    comp.onEntryTypeChange('photo');
    expect(comp.framingReferences()).toEqual([]);
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
  // The button once read "Save for ⟨name⟩" from a value that did not follow the select, so it could
  // name one patient while the form saved to another (frontend.md → "Patient identity").
  describe('patient select', () => {
    function renderFromPatientPage() {
      routeMock.snapshot.queryParamMap = new Map([['patientId', 'p1']]);
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/episodes')) return of([]);
        return of([
          { id: 'p1', fullName: 'Isla', dateOfBirth: '2020-01-01' },
          { id: 'p2', fullName: 'Sierra', dateOfBirth: '2021-01-01' },
        ]);
      });
      const fixture = TestBed.createComponent(NewObservationPage);
      fixture.detectChanges();
      return fixture;
    }

    function choosePatient(fixture: ReturnType<typeof renderFromPatientPage>, id: string) {
      const select = (fixture.nativeElement as HTMLElement).querySelector(
        'select[formControlName="patientId"]',
      ) as HTMLSelectElement;
      select.value = id;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('labels the save button plainly, before and after the patient is changed', () => {
      const fixture = renderFromPatientPage();
      const save = () =>
        (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]')?.textContent?.trim();
      expect(save()).toBe('Save');
      choosePatient(fixture, 'p2');
      expect(save()).toBe('Save');
      expect((fixture.nativeElement as HTMLElement).querySelector('.actions')?.textContent).not.toMatch(
        /Isla|Sierra/,
      );
    });

    it('saves to the patient chosen in the select, not the one the form was opened for', () => {
      apiMock.post.mockReturnValue(of({}));
      const fixture = renderFromPatientPage();
      choosePatient(fixture, 'p2');
      fixture.componentInstance.addEntry({ type: 'note', metadata: { text: 'hi' } });
      fixture.componentInstance.submit();
      expect(apiMock.post.mock.calls[0][0]).toBe('/patients/p2/observations');
    });
  });

  // frontend.md → "Entry list and the add-entry sheet".
  describe('entry list and add-entry sheet', () => {
    function renderFull() {
      apiMock.get.mockImplementation((path: string) => {
        if (path.includes('/episodes')) return of([]);
        return of([{ id: 'p1', fullName: 'Isla', dateOfBirth: '2020-01-01' }]);
      });
      apiMock.post.mockReturnValue(of({}));
      const fixture = TestBed.createComponent(NewObservationPage);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const composer = () =>
        fixture.debugElement.query(By.directive(EntryMetadataFormComponent))
          .componentInstance as EntryMetadataFormComponent;
      const click = (selector: string) => {
        (el.querySelector(selector) as HTMLButtonElement).click();
        fixture.detectChanges();
      };
      const sheetOpen = () => !!el.querySelector('.entry-sheet')?.classList.contains('open');
      const rows = () => Array.from(el.querySelectorAll('.entries li')) as HTMLElement[];
      return { fixture, el, composer, click, sheetOpen, rows };
    }

    it('starts with an empty list, a closed sheet and an Add entry button', () => {
      const { el, sheetOpen, rows } = renderFull();
      expect(rows().length).toBe(0);
      expect(sheetOpen()).toBe(false);
      expect(el.textContent).toContain('No entries yet');
      expect(el.querySelector('button.add-entry')?.textContent?.trim()).toBe('Add entry');
      // The composer has no Add button of its own here; the sheet's Save stands in for it.
      expect(el.querySelector('app-entry-metadata-form .entry-builder > button.secondary')).toBeNull();
    });

    it('adds an entry from the sheet, closes it, and lists the entry', () => {
      const { fixture, el, composer, click, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      expect(sheetOpen()).toBe(true);
      expect(el.querySelector('#entry-sheet-title')?.textContent).toContain('Add entry');
      composer().tempValue = 101.2;
      click('.entry-sheet-panel .actions .primary');
      expect(sheetOpen()).toBe(false);
      expect(rows().length).toBe(1);
      expect(rows()[0].textContent).toContain('101.2');
      expect(fixture.componentInstance.entries()[0].type).toBe('temperature');
    });

    it('keeps the sheet open and says why when the entry is incomplete', () => {
      const { el, click, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      click('.entry-sheet-panel .actions .primary');
      expect(sheetOpen()).toBe(true);
      expect(rows().length).toBe(0);
      expect(el.querySelector('.entry-sheet .error')?.textContent).toContain('Temperature is required');
    });

    it('edits a listed entry in place through the sheet', () => {
      const { fixture, el, composer, click, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      composer().tempValue = 99.5;
      click('.entry-sheet-panel .actions .primary');
      click('button.add-entry');
      composer().entryType = 'heart_rate';
      composer().numberValue = 120;
      click('.entry-sheet-panel .actions .primary');

      (rows()[0].querySelector('button.edit-entry') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(sheetOpen()).toBe(true);
      expect(el.querySelector('#entry-sheet-title')?.textContent).toContain('Edit entry');
      expect(composer().tempValue).toBe(99.5);
      composer().tempValue = 100.4;
      click('.entry-sheet-panel .actions .primary');

      const entries = fixture.componentInstance.entries();
      expect(entries.length).toBe(2);
      expect(entries[0].metadata.value).toBe(100.4);
      expect(entries[1].type).toBe('heart_rate');
    });

    it('removes a listed entry', () => {
      const { fixture, composer, click, rows } = renderFull();
      click('button.add-entry');
      composer().tempValue = 99.5;
      click('.entry-sheet-panel .actions .primary');
      (rows()[0].querySelector('button[aria-label="Remove this entry"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(rows().length).toBe(0);
    });

    it('closes an untouched sheet without asking', () => {
      const { el, click, sheetOpen } = renderFull();
      click('button.add-entry');
      click('.entry-sheet-panel .actions .secondary');
      expect(sheetOpen()).toBe(false);
      expect(el.querySelector('.entry-sheet-confirm')).toBeNull();
    });

    it('asks before discarding a half-filled entry, from Cancel, the scrim or Esc', () => {
      const { fixture, el, composer, click, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      composer().tempValue = 98.6;

      click('.entry-sheet-panel .actions .secondary');
      expect(sheetOpen()).toBe(true);
      expect(el.querySelector('.entry-sheet-confirm')?.textContent).toContain('Discard this entry?');
      click('.entry-sheet-confirm .secondary:not(.discard)'); // Keep editing
      expect(composer().tempValue).toBe(98.6);

      click('.entry-sheet-scrim');
      expect(el.querySelector('.entry-sheet-confirm')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(el.querySelector('.entry-sheet-confirm')).toBeNull(); // Esc backs out of the question

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      click('.entry-sheet-confirm .discard');
      expect(sheetOpen()).toBe(false);
      expect(rows().length).toBe(0);
      expect(composer().tempValue).toBeNull();
    });

    it('does not ask when an edited entry is closed unchanged', () => {
      const { fixture, el, composer, click, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      composer().tempValue = 99.5;
      click('.entry-sheet-panel .actions .primary');
      (rows()[0].querySelector('button.edit-entry') as HTMLButtonElement).click();
      fixture.detectChanges();
      click('.entry-sheet-panel .actions .secondary');
      expect(sheetOpen()).toBe(false);
      expect(el.querySelector('.entry-sheet-confirm')).toBeNull();
      expect(fixture.componentInstance.entries()[0].metadata.value).toBe(99.5);
    });

    it('saves the entry on Enter in one of its fields, never the observation', () => {
      const { el, fixture, click, composer, sheetOpen, rows } = renderFull();
      click('button.add-entry');
      composer().tempValue = 100.1;
      const input = el.querySelector('.entry-sheet input[name="tempValue"]') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(sheetOpen()).toBe(false);
      expect(rows().length).toBe(1);
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it('submits every listed entry with the observation', () => {
      const { fixture, composer, click } = renderFull();
      for (const v of [99.1, 100.2]) {
        click('button.add-entry');
        composer().tempValue = v;
        click('.entry-sheet-panel .actions .primary');
      }
      click('button[type="submit"]');
      const [path, payload] = apiMock.post.mock.calls[0];
      expect(path).toBe('/patients/p1/observations');
      expect(payload.entries.map((e: any) => e.metadata.value)).toEqual([99.1, 100.2]);
      expect(fixture.componentInstance.entries().length).toBe(2);
    });
  });

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

    // frontend.md → Quick Log → "Episode attachment": on the full form the start control is on
    // screen without opening anything, whatever the patient's episode state.
    const hasMore = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('button')).some((b) => ['More', 'Less'].includes(b.textContent!.trim()));

    for (const [label, episodes] of [
      ['no active episode', []],
      ['one active episode', [{ id: 'ep1', name: 'Fever' }]],
      ['two active episodes', [{ id: 'ep1', name: 'Fever' }, { id: 'ep2', name: 'Rash' }]],
    ] as const) {
      it(`shows "Start a new episode" with no More to open — ${label}`, () => {
        const el = renderWithEpisodes([...episodes]).nativeElement as HTMLElement;
        expect(el.textContent).toContain('Start a new episode');
        expect(hasMore(el)).toBe(false);
      });
    }

    it('starts a new episode from the visible control, unchanged on the wire', () => {
      const fixture = renderWithEpisodes([{ id: 'ep1', name: 'Fever' }]);
      const el = fixture.nativeElement as HTMLElement;
      const start = Array.from(el.querySelectorAll('app-episode-attachment label.inline-check')).find((l) =>
        l.textContent!.includes('Start a new episode'),
      )!.querySelector('input') as HTMLInputElement;
      start.click();
      fixture.detectChanges();
      const name = el.querySelector('app-episode-attachment input[type="text"]') as HTMLInputElement;
      name.value = 'Croup';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      apiMock.post.mockReturnValue(of({ id: 'o1' }));
      const comp = fixture.componentInstance;
      comp.form.patchValue({ observedAt: '2026-11-16T03:00' });
      comp.entries.set([{ type: 'note', metadata: { text: 'coughing' } } as any]);
      comp.submit();
      const body = apiMock.post.mock.calls[0][1];
      expect(body.startEpisodeName).toBe('Croup');
      expect(body.episodeIds).toEqual(['ep1']);
      expect(body.resolvesEpisodeIds).toBeUndefined();
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

    // The pinned "For Kiddo" line names the patient; the button does not repeat it.
    // The quick tiles stay minimal: the episode options stay behind More there.
    it('keeps "Start a new episode" behind More', () => {
      const fixture = renderCompact('temperature');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).not.toContain('Start a new episode');
      const more = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'More');
      more!.click();
      fixture.detectChanges();
      expect(el.textContent).toContain('Start a new episode');
    });

    it('labels the save button plainly, with no patient name', () => {
      const fixture = renderCompact('pain_score');
      const save = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]');
      expect(save?.textContent?.trim()).toBe('Save');
    });

    // Quick Log's verbs keep their inline composer: no list header, no sheet (frontend.md → Quick Log).
    it('keeps the inline composer and has no add-entry sheet', () => {
      const fixture = renderCompact('temperature');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.entry-sheet')).toBeNull();
      expect(el.querySelector('button.add-entry')).toBeNull();
      expect(el.querySelector('app-entry-metadata-form button.secondary')?.textContent?.trim()).toBe('Add entry');
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
