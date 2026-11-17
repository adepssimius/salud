import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { EditObservationPage } from './edit-observation.page';
import { NewObservationPage } from './new-observation.page';
import { EntryMetadataFormComponent } from './entry-metadata-form.component';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ERROR_SENTENCES } from '../core/error-display';
import { toLocalDateTimeInput } from '../core/entry-correction';

const OBSERVED_AT = 1700000000;

function makeObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obs-1',
    patientId: 'p1',
    recordedByUserId: 'u2',
    observedAt: OBSERVED_AT,
    text: 'Woke up hot',
    episodeIds: ['ep1'],
    resolvesEpisodeIds: [],
    unitPreferenceAtEntry: { temp: 'C', weight: 'kg', length: 'cm' },
    createdAt: OBSERVED_AT + 600,
    updatedAt: OBSERVED_AT + 600,
    entries: [
      { id: 'e1', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'tympanic' } },
      {
        id: 'e4',
        type: 'lab_result',
        metadata: { analyteId: 'a1', analyte: 'FERRITIN', valueText: '18', unit: 'ng/mL', flag: 'L' },
        labContext: { displayName: 'Ferritin', ranges: [] },
      },
    ],
    ...overrides,
  };
}

const episodes = [
  { id: 'ep1', patientId: 'p1', name: 'Fever', status: 'active', startedAtType: 'observation', startedAtId: 'obs-1' },
  { id: 'ep2', patientId: 'p1', name: 'Rash', status: 'active', startedAtType: 'intervention', startedAtId: 'iv-9' },
  { id: 'ep3', patientId: 'p1', name: 'Old cold', status: 'resolved', startedAtType: 'observation', startedAtId: 'obs-0' },
];

describe('EditObservationPage', () => {
  let apiMock: any;
  let routerMock: any;
  let observation: any;

  beforeEach(async () => {
    observation = makeObservation();
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/observations/obs-1') return of(observation);
        if (path === '/patients/p1') return of({ id: 'p1', fullName: 'Pat' });
        if (path === '/patients/p1/episodes') return of(episodes);
        if (path === '/patients/p1/care-team') {
          return of([{ user: { id: 'u2', displayName: 'Sam Nightshift' }, role: 'co-parent' }]);
        }
        return of([]);
      }),
      post: jest.fn().mockReturnValue(of({})),
      patch: jest.fn().mockReturnValue(of({ ...observation })),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [EditObservationPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        {
          provide: AuthService,
          useValue: {
            token: 't',
            user: jest.fn().mockReturnValue({
              id: 'u1',
              displayName: 'Me',
              preferredTempUnit: 'F',
              preferredWeightUnit: 'kg',
              preferredLengthUnit: 'cm',
            }),
            me: jest.fn(),
            logout: jest.fn(),
          },
        },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: 'obs-1' }), queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(EditObservationPage);
    fixture.detectChanges();
    fixture.detectChanges();
    const form = fixture.debugElement.query(By.directive(NewObservationPage))?.componentInstance as NewObservationPage;
    return { fixture, form, el: fixture.nativeElement as HTMLElement };
  }

  function save(fixture: any) {
    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();
  }

  it('pre-fills the stored observation, in the reader’s units, with the patient shown and not selectable', () => {
    const { el, form } = render();
    expect(el.querySelector('h1')?.textContent).toContain('Correct observation');
    expect(el.querySelector('.for-patient')?.textContent).toContain('Pat');
    expect(el.querySelector('select[formcontrolname="patientId"]')).toBeNull();

    const time = el.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(time.value).toBe(toLocalDateTimeInput(OBSERVED_AT));
    expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Woke up hot');

    // 38.5 °C stored, read back in this reader's °F.
    expect(el.querySelector('.entries')?.textContent).toContain('101.3 °F');
    expect(form.entries().map((e: any) => e.id)).toEqual(['e1', 'e4']);
    // Attribution and the recorder's units are fixed, and read as text.
    expect(el.textContent).toContain('Recorded by Sam Nightshift');
    expect(el.textContent).toContain('Entered in °C · kg · cm');
  });

  it('sends nothing when nothing changed, and returns to the entry', () => {
    const { fixture } = render();
    save(fixture);
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations', 'obs-1']);
  });

  it('PATCHes only the changed fields', () => {
    const { fixture, form } = render();
    form.form.patchValue({ text: 'Woke up hot, gave a bath' });
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/observations/obs-1', { text: 'Woke up hot, gave a bath' });
  });

  it('sends a corrected time as an ISO datetime', () => {
    const { fixture, form } = render();
    form.form.patchValue({ observedAt: '2023-11-14T20:05' });
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/observations/obs-1', {
      observedAt: new Date('2023-11-14T20:05').toISOString(),
    });
  });

  it('changes an entry in the reader’s units, keeps its id, and echoes the lab result untouched', () => {
    const { fixture, form, el } = render();
    const change = Array.from(el.querySelectorAll('button.edit-entry')) as HTMLButtonElement[];
    // Only the temperature is changeable — the lab result is read-only.
    expect(change.length).toBe(1);
    change[0].click();
    fixture.detectChanges();
    // Edit opens the add-entry sheet, prefilled (frontend.md → "Correcting an entry").
    expect(el.querySelector('.entry-sheet')?.classList).toContain('open');
    expect(el.querySelector('#entry-sheet-title')?.textContent).toContain('Edit entry');

    const composer = fixture.debugElement.query(By.directive(EntryMetadataFormComponent))
      .componentInstance as EntryMetadataFormComponent;
    expect(composer.entryType).toBe('temperature');
    expect(composer.tempUnit).toBe('F');
    expect(composer.tempValue).toBe(101.3);
    expect(composer.tempMethod).toBe('tympanic');

    composer.tempValue = 102.2;
    (el.querySelector('.entry-sheet-panel .actions .primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.entry-sheet')?.classList).not.toContain('open');
    save(fixture);

    const [, body] = apiMock.patch.mock.calls[0];
    expect(Object.keys(body)).toEqual(['entries']);
    expect(body.entries).toEqual([
      { id: 'e1', type: 'temperature', metadata: { value: 102.2, unit: 'F', method: 'tympanic', note: undefined } },
      {
        id: 'e4',
        type: 'lab_result',
        metadata: { analyteId: 'a1', analyte: 'FERRITIN', valueText: '18', unit: 'ng/mL', flag: 'L' },
      },
    ]);
    expect(body.entries[1].labContext).toBeUndefined();
    expect(form.entries().length).toBe(2);
  });

  it('shows a lab result read-only — no change, no remove', () => {
    const { el } = render();
    const rows = Array.from(el.querySelectorAll('.entries li')) as HTMLElement[];
    const lab = rows[1];
    expect(lab.textContent).toContain('read-only');
    expect(lab.querySelector('button')).toBeNull();
  });

  it('adds a new entry alongside the stored ones', () => {
    const { fixture, form } = render();
    form.addEntry({ type: 'heart_rate', metadata: { bpm: 120 } });
    save(fixture);
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body.entries[2]).toEqual({ type: 'heart_rate', metadata: { bpm: 120 } });
  });

  it('will not remove the last remaining entry', () => {
    observation = makeObservation({
      entries: [{ id: 'e1', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
    });
    const { fixture, form, el } = render();
    expect(el.querySelector('.entries .icon-button')).toBeNull();
    expect(el.textContent).toContain('An observation keeps at least one entry.');
    form.removeEntry(0);
    fixture.detectChanges();
    expect(form.entries().length).toBe(1);
  });

  it('removes one of several entries', () => {
    observation = makeObservation({
      entries: [
        { id: 'e1', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } },
        { id: 'e2', type: 'heart_rate', metadata: { bpm: 110 } },
      ],
    });
    const { fixture, el } = render();
    (el.querySelectorAll('.entries .icon-button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    save(fixture);
    expect(apiMock.patch.mock.calls[0][1].entries).toEqual([
      { id: 'e1', type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } },
    ]);
  });

  it('shows the episode this entry started checked and locked, and offers no new episode', () => {
    const { el } = render();
    const chips = Array.from(el.querySelectorAll('app-episode-attachment .chip')) as HTMLButtonElement[];
    const fever = chips.find((b) => b.textContent?.trim() === 'Fever')!;
    expect(fever.classList).toContain('chip-on');
    expect(fever.disabled).toBe(true);
    expect(el.textContent).toContain('This entry started this episode');
    expect(el.textContent).not.toMatch(/start a new episode/i);
    expect(chips.some((b) => b.textContent?.trim() === 'More')).toBe(false);
    // Active episodes are offered; a resolved one the entry is not linked to is not.
    expect(el.textContent).toContain('Rash');
    expect(el.textContent).not.toContain('Old cold');
  });

  it('leaves a stored partial resolution alone until the resolve switch is touched', () => {
    observation = makeObservation({ episodeIds: ['ep1', 'ep2'], resolvesEpisodeIds: ['ep3'] });
    const { fixture, form } = render();
    // Detaching ep2 keeps ep3's stored resolution as it was …
    form.setEpisodeSelection(['ep1', 'ep3']);
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/observations/obs-1', {
      episodeIds: ['ep1', 'ep3'],
      resolvesEpisodeIds: ['ep3'],
    });
  });

  it('sends both episode lists whole when an episode is attached and resolved', () => {
    const { fixture, el } = render();
    const rash = (Array.from(el.querySelectorAll('.chip')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Rash'),
    )!;
    rash.click();
    fixture.detectChanges();
    const resolve = el.querySelector('app-episode-attachment input[type="checkbox"]') as HTMLInputElement;
    resolve.click();
    fixture.detectChanges();
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/observations/obs-1', {
      episodeIds: ['ep1', 'ep2'],
      resolvesEpisodeIds: ['ep2'],
    });
  });

  it.each(['FIELD_NOT_CORRECTABLE', 'CANNOT_UNLINK_STARTED_EPISODE', 'EPISODE_TIME_ORDER_INVALID'] as const)(
    'shows the %s sentence and keeps the form filled',
    (code) => {
      apiMock.patch.mockReturnValue(throwError(() => ({ status: 400, error: { message: code, fields: ['x'] } })));
      const { fixture, form, el } = render();
      form.form.patchValue({ text: 'corrected words' });
      save(fixture);
      expect(el.querySelector('.error')?.textContent).toContain(ERROR_SENTENCES[code]);
      expect(form.form.getRawValue().text).toBe('corrected words');
      expect(form.entries().length).toBe(2);
      expect(routerMock.navigate).not.toHaveBeenCalled();
    },
  );

  it('falls back to "Could not save the correction." for an uncatalogued failure', () => {
    apiMock.patch.mockReturnValue(throwError(() => ({ status: 500, error: {} })));
    const { fixture, form, el } = render();
    form.form.patchValue({ text: 'x' });
    save(fixture);
    expect(el.querySelector('.error')?.textContent).toContain('Could not save the correction.');
  });

  it('returns to the detail page after a save', () => {
    const { fixture, form } = render();
    form.form.patchValue({ text: 'x' });
    save(fixture);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations', 'obs-1']);
  });

  it('shows the protocol card first when the correction tripped a protocol', () => {
    apiMock.patch.mockReturnValue(
      of({
        ...observation,
        firedAdvisories: [
          {
            id: 'adv1',
            type: 'protocol_fired',
            payload: { protocolName: 'High fever', instructionText: 'Call the clinic', triggerOperator: 'gte' },
          },
        ],
      }),
    );
    const { fixture, form, el } = render();
    form.form.patchValue({ text: 'x' });
    save(fixture);
    expect(routerMock.navigate).not.toHaveBeenCalled();
    expect(el.querySelector('h1')?.textContent).toContain('Correction saved');
    expect(el.querySelector('.protocol-card')?.textContent).toContain('High fever');
    const back = (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Back to the entry',
    )!;
    back.click();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations', 'obs-1']);
  });

  it('Cancel sends nothing and returns to the entry', () => {
    const { fixture, form, el } = render();
    form.form.patchValue({ text: 'never sent' });
    fixture.detectChanges();
    const cancel = (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/observations', 'obs-1']);
  });

  it('reads a load failure the same way the detail page does', () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/observations/obs-1' ? throwError(() => ({ status: 404, error: { message: 'OBSERVATION_NOT_FOUND' } })) : of([]),
    );
    const { el, form } = render();
    expect(form).toBeUndefined();
    expect(el.querySelector('.error')).not.toBeNull();
  });
});
