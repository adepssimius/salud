import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { EditInterventionPage } from './edit-intervention.page';
import { NewInterventionPage } from './new-intervention.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ERROR_SENTENCES } from '../core/error-display';
import { toLocalDateTimeInput } from '../core/entry-correction';

const PERFORMED_AT = 1700000000;

function makeDose(overrides: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    id: 'iv-1',
    patientId: 'p1',
    recordedByUserId: 'u2',
    performedAt: PERFORMED_AT,
    type: 'medication_dose',
    scheduleId: null,
    episodeIds: ['ep1'],
    resolvesEpisodeIds: [],
    notes: 'Spat a little out',
    metadata: {
      medicationId: 'm1',
      medicationEmbodimentId: 'emb1',
      doseSource: 'weight_based',
      amountMg: 160,
      amountMl: 5,
      pillCount: null,
      guidelineId: 'g1',
      weightKgUsed: 14.5,
      ...metadata,
    },
    createdAt: PERFORMED_AT + 60,
    updatedAt: PERFORMED_AT + 60,
    ...overrides,
  };
}

const episodes = [
  { id: 'ep1', patientId: 'p1', name: 'Fever', status: 'active', startedAtType: 'intervention', startedAtId: 'iv-1' },
];

const doseCheck = { guidance: { weightBased: null, ageBand: null }, advisories: [] };

describe('EditInterventionPage', () => {
  let apiMock: any;
  let routerMock: any;
  let intervention: any;

  beforeEach(async () => {
    intervention = makeDose();
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/interventions/iv-1') return of(intervention);
        if (path === '/patients/p1') return of({ id: 'p1', fullName: 'Pat' });
        if (path === '/patients/p1/episodes') return of(episodes);
        if (path === '/patients/p1/care-team') {
          return of([{ user: { id: 'u2', displayName: 'Sam Nightshift' }, role: 'co-parent' }]);
        }
        if (path === '/schedules/s1') return of({ id: 's1', label: 'Fever plan' });
        if (path === '/medications/m1') return of({ id: 'm1', name: 'Acetaminophen', brandNames: ['Tylenol'] });
        if (path === '/medications/m1/embodiments') {
          return of([{ id: 'emb1', label: 'Infant drops 160 mg/5 mL', atHome: true, runningLow: false, expiresAt: null }]);
        }
        return of([]);
      }),
      post: jest.fn().mockReturnValue(of(doseCheck)),
      patch: jest.fn().mockReturnValue(of(intervention)),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [EditInterventionPage],
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
              preferredWeightUnit: 'lb',
              preferredLengthUnit: 'in',
            }),
            me: jest.fn(),
            logout: jest.fn(),
          },
        },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: 'iv-1' }), queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(EditInterventionPage);
    fixture.detectChanges();
    fixture.detectChanges();
    const form = fixture.debugElement.query(By.directive(NewInterventionPage))?.componentInstance as NewInterventionPage;
    return { fixture, form, el: fixture.nativeElement as HTMLElement };
  }

  function save(fixture: any) {
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const patchCalls = () => apiMock.patch.mock.calls;
  const doseCheckCalls = () => apiMock.post.mock.calls.filter(([path]: [string]) => path.endsWith('/dose-checks'));

  it('pre-fills a stored dose, with the patient, type and attribution as text', () => {
    const { el, form } = render();
    expect(el.querySelector('h1')?.textContent).toContain('Correct dose');
    expect(el.querySelector('.for-patient')?.textContent).toContain('Pat');
    expect(el.querySelector('select[formcontrolname="patientId"]')).toBeNull();
    expect(el.querySelector('select[formcontrolname="type"]')).toBeNull();
    expect(el.querySelector('.fixed-type')?.textContent).toContain('Medication dose');
    expect(el.textContent).toContain('Recorded by Sam Nightshift');
    // The free-text schedule id field is a create-only control.
    expect(el.querySelector('input[formcontrolname="interventionScheduleId"]')).toBeNull();

    const v = form.form.getRawValue();
    expect(v.performedAt).toBe(toLocalDateTimeInput(PERFORMED_AT));
    expect(v.medicationId).toBe('m1');
    expect(v.medicationEmbodimentId).toBe('emb1');
    expect(v.doseSource).toBe('weight_based');
    expect(v.amountMg).toBe(160);
    expect(v.amountMl).toBe(5);
    expect(v.notes).toBe('Spat a little out');
    expect(el.querySelector('.chosen-med')?.textContent).toContain('Acetaminophen');
    expect(el.querySelector('select[formcontrolname="doseSource"]')).not.toBeNull();
    expect(el.textContent).toContain("Doses logged after this one keep the checks they were given at the time");
  });

  it('sends nothing when nothing changed, and returns to the entry', () => {
    const { fixture } = render();
    save(fixture);
    expect(patchCalls().length).toBe(0);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions', 'iv-1']);
  });

  it('PATCHes only the changed fields', () => {
    const { fixture, form } = render();
    form.form.patchValue({ notes: 'Took it all', amountMg: 120 });
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/interventions/iv-1', { notes: 'Took it all', amountMg: 120 });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions', 'iv-1']);
  });

  it('sends a corrected time as an ISO datetime', () => {
    const { fixture, form } = render();
    form.form.patchValue({ performedAt: '2023-11-14T21:30' });
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/interventions/iv-1', {
      performedAt: new Date('2023-11-14T21:30').toISOString(),
    });
  });

  it('runs the live dose check at the corrected time', fakeAsync(() => {
    const { fixture, form } = render();
    tick(400);
    // The stored dose is previewed as soon as the form is filled …
    expect(doseCheckCalls().length).toBeGreaterThan(0);
    expect(doseCheckCalls().at(-1)[1].occurredAt).toBe(new Date(toLocalDateTimeInput(PERFORMED_AT)).toISOString());

    // … and re-checked at whatever time the caregiver corrects it to.
    form.form.patchValue({ performedAt: '2023-11-14T21:30', amountMg: 200 });
    tick(400);
    fixture.detectChanges();
    const [path, body] = doseCheckCalls().at(-1);
    expect(path).toBe('/patients/p1/dose-checks');
    expect(body).toEqual({
      medicationId: 'm1',
      medicationEmbodimentId: 'emb1',
      amountMg: 200,
      occurredAt: new Date('2023-11-14T21:30').toISOString(),
      // The dose being corrected is not its own prior dose.
      excludeInterventionId: 'iv-1',
    });
    expect(doseCheckCalls().every(([, b]: [string, any]) => b.excludeInterventionId === 'iv-1')).toBe(true);
  }));

  it('keeps the danger interstitial on a correction', fakeAsync(() => {
    apiMock.post.mockReturnValue(
      of({ guidance: { weightBased: null, ageBand: null }, advisories: [{ type: 'reaction_danger', payload: {} }] }),
    );
    const { fixture } = render();
    tick(400);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-danger-interstitial')).not.toBeNull();
  }));

  it('fixes a scheduled dose’s source and names its schedule as text', () => {
    intervention = makeDose({ scheduleId: 's1' }, { doseSource: 'schedule' });
    const { fixture, form, el } = render();
    expect(el.querySelector('select[formcontrolname="doseSource"]')).toBeNull();
    expect(el.querySelector('.fixed-dose-source')?.textContent).toContain('From schedule');
    expect(el.querySelector('.fixed-schedule')?.textContent).toContain('Fever plan');

    form.form.patchValue({ amountMg: 120 });
    save(fixture);
    expect(apiMock.patch).toHaveBeenCalledWith('/interventions/iv-1', { amountMg: 120 });
  });

  it('shows the episode this dose started attached but detachable, with no new-episode option', () => {
    const { el } = render();
    // The only episode, so the picker's single "attached" branch — with its detach button, since
    // unlinking the start moves it to the next-earliest entry (data-model.md).
    expect(el.querySelector('app-episode-attachment .pill')?.textContent).toContain('Fever');
    expect(el.querySelector('app-episode-attachment .chip-remove')).not.toBeNull();
    expect(el.textContent).not.toContain('This entry started this episode');
    expect(el.textContent).not.toMatch(/start a new episode/i);
  });

  it('refuses to send a cleared amount rather than silently keeping the old one', () => {
    const { fixture, form, el } = render();
    form.form.patchValue({ amountMg: null });
    save(fixture);
    expect(patchCalls().length).toBe(0);
    expect(el.querySelector('.error')?.textContent).toContain('Enter the amount in mg.');
  });

  it.each(['FIELD_NOT_CORRECTABLE', 'EPISODE_LAST_ENTRY', 'EPISODE_TIME_ORDER_INVALID'] as const)(
    'shows the %s sentence and keeps the form filled',
    (code) => {
      apiMock.patch.mockReturnValue(throwError(() => ({ status: 400, error: { message: code, fields: ['type'] } })));
      const { fixture, form, el } = render();
      form.form.patchValue({ notes: 'my correction' });
      save(fixture);
      expect(el.querySelector('.error')?.textContent).toContain(ERROR_SENTENCES[code]);
      expect(form.form.getRawValue().notes).toBe('my correction');
      expect(form.form.getRawValue().amountMg).toBe(160);
      expect(routerMock.navigate).not.toHaveBeenCalled();
    },
  );

  it('falls back to "Could not save the correction."', () => {
    apiMock.patch.mockReturnValue(throwError(() => ({ status: 500, error: {} })));
    const { fixture, form, el } = render();
    form.form.patchValue({ notes: 'x' });
    save(fixture);
    expect(el.querySelector('.error')?.textContent).toContain('Could not save the correction.');
  });

  describe('a dressing change', () => {
    beforeEach(() => {
      intervention = {
        ...makeDose(),
        type: 'dressing_change',
        notes: null,
        metadata: { bodyLocation: 'Left knee', side: 'left', dressingType: 'gauze' },
      };
    });

    it('is headed "Correct dressing change" and pre-fills its fields', () => {
      const { el, form } = render();
      expect(el.querySelector('h1')?.textContent).toContain('Correct dressing change');
      expect(el.querySelector('.fixed-type')?.textContent).toContain('Dressing change');
      const v = form.form.getRawValue();
      expect([v.bodyLocation, v.side, v.dressingType]).toEqual(['Left knee', 'left', 'gauze']);
    });

    it('sends only the changed dressing fields', () => {
      const { fixture, form } = render();
      form.form.patchValue({ side: 'right', dressingType: 'hydrocolloid' });
      save(fixture);
      expect(apiMock.patch).toHaveBeenCalledWith('/interventions/iv-1', { side: 'right', dressingType: 'hydrocolloid' });
    });

    it('does not send an emptied body location', () => {
      const { fixture, form, el } = render();
      form.form.patchValue({ bodyLocation: '  ' });
      save(fixture);
      expect(patchCalls().length).toBe(0);
      expect(el.querySelector('.error')?.textContent).toContain(ERROR_SENTENCES.BODY_LOCATION_REQUIRED);
    });
  });

  it('Cancel sends nothing and returns to the entry', () => {
    const { fixture, form, el } = render();
    form.form.patchValue({ notes: 'never sent' });
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.trim() === 'Cancel')!
      .click();
    expect(patchCalls().length).toBe(0);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions', 'iv-1']);
  });

  it('reads a load failure the same way the detail page does', () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/interventions/iv-1'
        ? throwError(() => ({ status: 404, error: { message: 'INTERVENTION_NOT_FOUND' } }))
        : of([]),
    );
    const { el, form } = render();
    expect(form).toBeUndefined();
    expect(el.querySelector('.error')).not.toBeNull();
  });
});
