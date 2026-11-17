import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EmbodimentEditorComponent, fromDateInput, toDateInput } from './embodiment-editor.component';
import { ApiClientService } from '../core/api-client.service';

const SYRUP = {
  id: 'e1',
  medicationId: 'm1',
  label: '160 mg / 5 mL syrup',
  concentrationMgPerMl: 32,
  concentrationMg: 160,
  concentrationVolumeMl: 5,
  strengthMgPerUnit: null,
  unitType: 'ml' as const,
  dosageForm: 'liquid' as const,
  notes: null,
  atHome: true,
  expiresAt: null,
  runningLow: false,
  runningLowFlaggedByUserId: null,
  runningLowFlaggedAt: null,
};

describe('EmbodimentEditorComponent', () => {
  let apiMock: any;

  beforeEach(async () => {
    apiMock = { post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [EmbodimentEditorComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => jest.restoreAllMocks());

  function build(embodiment: any = null) {
    const fixture = TestBed.createComponent(EmbodimentEditorComponent);
    fixture.componentInstance.medicationId = 'm1';
    fixture.componentInstance.embodiment = embodiment;
    fixture.detectChanges();
    return fixture;
  }

  describe('adding', () => {
    // The point of the pair: the form posts what the bottle prints, and the server does the
    // division. A UI that divided here would just move the arithmetic error to the client.
    it('posts the printed concentration pair', () => {
      apiMock.post.mockReturnValue(of({ id: 'e2' }));
      const comp = build().componentInstance;

      comp.form.patchValue({ label: '5mL syrup', dosageForm: 'liquid', concentrationMg: 160, concentrationVolumeMl: 5 });
      expect(comp.derivedConcentration()).toBe(32);
      comp.save();
      expect(apiMock.post).toHaveBeenCalledWith('/medications/m1/embodiments', {
        label: '5mL syrup',
        dosageForm: 'liquid',
        concentrationMg: 160,
        concentrationVolumeMl: 5,
        strengthMgPerUnit: undefined,
        notes: undefined,
        expiresAt: undefined,
      });
    });

    it('omits the concentration entirely for a solid form, rather than sending a bare 1 mL', () => {
      apiMock.post.mockReturnValue(of({ id: 'e3' }));
      const comp = build().componentInstance;

      // The volume box defaults to 1; a tablet leaves the mg box empty, and "per 1 mL" alone means
      // nothing -- sending it would 400 with CONCENTRATION_PAIR_INCOMPLETE.
      comp.form.patchValue({ label: '500 mg tablet', dosageForm: 'tablet', strengthMgPerUnit: 500 });
      comp.save();
      expect(apiMock.post).toHaveBeenCalledWith(
        '/medications/m1/embodiments',
        expect.objectContaining({ concentrationMg: undefined, concentrationVolumeMl: undefined, strengthMgPerUnit: 500 }),
      );
    });

    it('sends an expiry date as an ISO datetime', () => {
      apiMock.post.mockReturnValue(of({ id: 'e4' }));
      const comp = build().componentInstance;

      comp.form.patchValue({ label: 'tablet', expiresAt: '2027-03-01' });
      comp.save();
      expect(apiMock.post.mock.calls[0][1].expiresAt).toBe(new Date(2027, 2, 1).toISOString());
    });

    it('does not flag the untouched form, where the volume box is pre-filled with 1', () => {
      const comp = build().componentInstance;

      // Regression: a symmetric "exactly one filled" check made the *starting* state incomplete
      // (no mg, 1 mL), which disabled Add for every tablet.
      expect(comp.concentrationPairIncomplete()).toBe(false);
      expect(comp.form.getRawValue().concentrationVolumeMl).toBe(1);
    });

    it('flags a half-filled concentration pair before it can be submitted', () => {
      const comp = build().componentInstance;

      comp.form.patchValue({ label: 'syrup', dosageForm: 'liquid', concentrationMg: 160, concentrationVolumeMl: null });
      expect(comp.concentrationPairIncomplete()).toBe(true);
      expect(comp.derivedConcentration()).toBeNull();
      comp.save();
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it('keeps the form filled and says why when the add fails', () => {
      apiMock.post.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'CONCENTRATION_OUT_OF_RANGE' } })));
      const comp = build().componentInstance;

      comp.form.patchValue({ label: 'syrup', dosageForm: 'liquid', concentrationMg: 160, concentrationVolumeMl: 0.001 });
      comp.save();
      expect(comp.error()).toContain('no medicine comes in');
      expect(comp.form.getRawValue().label).toBe('syrup');
      expect(comp.saving()).toBe(false);
    });
  });

  describe('editing', () => {
    it('prefills from the row, the pair as printed', () => {
      const comp = build(SYRUP).componentInstance;
      expect(comp.form.getRawValue()).toEqual({
        label: '160 mg / 5 mL syrup',
        dosageForm: 'liquid',
        concentrationMg: 160,
        concentrationVolumeMl: 5,
        strengthMgPerUnit: null,
        notes: '',
        expiresAt: '',
      });
      expect(comp.derivedConcentration()).toBe(32);
    });

    it('asks for the form, and sends only the form when it changes — the unit follows it server-side', () => {
      apiMock.patch.mockReturnValue(of({ ...SYRUP }));
      const fixture = build({ ...SYRUP, unitType: 'other', dosageForm: null, concentrationMg: null, concentrationVolumeMl: null, concentrationMgPerMl: null });
      const comp = fixture.componentInstance;
      const select = fixture.nativeElement.querySelector('select[formControlName="dosageForm"]') as HTMLSelectElement;
      // An untyped row says so, in its unit, until a form is picked.
      expect(select.options[0].textContent).toContain('Not set');
      expect([...select.options].map((o) => o.value)).toContain('cream');
      expect(comp.changes()).toEqual({});
      comp.form.patchValue({ dosageForm: 'cream' });
      expect(comp.changes()).toEqual({ dosageForm: 'cream' });
    });

    it('edits a row stored only as a per-mL figure as "N mg per 1 mL"', () => {
      const comp = build({ ...SYRUP, concentrationMg: null, concentrationVolumeMl: null }).componentInstance;
      expect(comp.form.getRawValue().concentrationMg).toBe(32);
      expect(comp.form.getRawValue().concentrationVolumeMl).toBe(1);
      // Unchanged, so nothing about the concentration is sent.
      comp.form.patchValue({ label: 'renamed' });
      expect(comp.changes()).toEqual({ label: 'renamed' });
    });

    it('PATCHes only the label and expiry when only those changed', () => {
      apiMock.patch.mockReturnValue(of(SYRUP));
      const comp = build(SYRUP).componentInstance;

      comp.form.patchValue({ label: 'Infant syrup', expiresAt: '2027-03-01' });
      comp.save();
      expect(apiMock.patch).toHaveBeenCalledWith('/embodiments/e1', {
        label: 'Infant syrup',
        expiresAt: new Date(2027, 2, 1).toISOString(),
      });
    });

    it('clears a set expiry with null', () => {
      const expiresAt = Math.floor(new Date(2027, 2, 1).getTime() / 1000);
      const comp = build({ ...SYRUP, expiresAt }).componentInstance;
      expect(comp.form.getRawValue().expiresAt).toBe('2027-03-01');

      comp.form.patchValue({ expiresAt: '' });
      expect(comp.changes()).toEqual({ expiresAt: null });
    });

    it('sends the whole pair when either half changes, and never the per-mL figure', () => {
      const comp = build(SYRUP).componentInstance;
      comp.form.patchValue({ concentrationVolumeMl: 10 });
      expect(comp.changes()).toEqual({ concentrationMg: 160, concentrationVolumeMl: 10 });
      expect(comp.changes()).not.toHaveProperty('concentrationMgPerMl');
    });

    it('clears the concentration by sending a null mg', () => {
      const comp = build(SYRUP).componentInstance;
      comp.form.patchValue({ concentrationMg: null });
      expect(comp.changes()).toEqual({ concentrationMg: null });
    });

    it('treats an unchanged form as a cancel, without a request', () => {
      const fixture = build(SYRUP);
      const cancelled = jest.fn();
      fixture.componentInstance.cancelled.subscribe(cancelled);
      fixture.componentInstance.save();
      expect(apiMock.patch).not.toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalled();
    });

    it('disables Save while the request is in flight', () => {
      apiMock.patch.mockReturnValue({ subscribe: () => undefined }); // never completes
      const fixture = build(SYRUP);
      fixture.componentInstance.form.patchValue({ label: 'x' });
      fixture.componentInstance.save();
      fixture.detectChanges();
      const submit: HTMLButtonElement = fixture.nativeElement.querySelector('button[type=submit]');
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toContain('Saving');
    });

    // Live check pending the API session's lock: this is the mocked shape of its 409.
    it('on a concentration lock, explains, reads the dependents back and offers a new form', () => {
      apiMock.patch.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { message: 'EMBODIMENT_CONCENTRATION_IN_USE', dependents: { interventions: 3, schedules: 1 } },
        })),
      );
      const fixture = build(SYRUP);
      const comp = fixture.componentInstance;

      comp.form.patchValue({ concentrationMg: 100 });
      comp.save();
      fixture.detectChanges();

      expect(comp.error()).toContain('add it as a new form');
      expect(comp.lockedDependents()).toBe('Still used by 3 logged doses and 1 schedule.');
      const offer = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.trim() === 'Add as a new form',
      )!;
      expect(offer).toBeTruthy();

      // The same component switches to adding, with everything the caregiver typed still in place.
      offer.click();
      fixture.detectChanges();
      expect(comp.editing()).toBeNull();
      expect(comp.form.getRawValue().concentrationMg).toBe(100);

      apiMock.post.mockReturnValue(of({ id: 'e9' }));
      comp.save();
      expect(apiMock.post).toHaveBeenCalledWith(
        '/medications/m1/embodiments',
        expect.objectContaining({ label: '160 mg / 5 mL syrup', concentrationMg: 100, concentrationVolumeMl: 5 }),
      );
      expect(apiMock.patch).toHaveBeenCalledTimes(1);
    });

    it('deletes after a confirm', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(of(undefined));
      const fixture = build(SYRUP);
      const deleted = jest.fn();
      fixture.componentInstance.deleted.subscribe(deleted);

      fixture.componentInstance.remove();
      expect(apiMock.delete).toHaveBeenCalledWith('/embodiments/e1');
      expect(deleted).toHaveBeenCalledWith('e1');
    });

    it('does nothing when the confirm is declined', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      build(SYRUP).componentInstance.remove();
      expect(apiMock.delete).not.toHaveBeenCalled();
    });

    it('reads the dependents back and suggests unticking "At home" when the form is in use', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'EMBODIMENT_IN_USE', dependents: { interventions: 1 } } })),
      );
      const fixture = build(SYRUP);
      fixture.componentInstance.remove();
      fixture.detectChanges();

      expect(fixture.componentInstance.inUseDependents()).toBe('Still used by 1 logged dose.');
      expect(fixture.nativeElement.textContent).toContain('untick "At home"');
    });
  });

  it('round-trips a date through the input format', () => {
    const iso = fromDateInput('2027-03-01')!;
    expect(toDateInput(new Date(iso).getTime() / 1000)).toBe('2027-03-01');
    expect(fromDateInput('')).toBeNull();
    expect(toDateInput(null)).toBe('');
  });
});
