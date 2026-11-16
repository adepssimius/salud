import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GuidelineEditorComponent } from './guideline-editor.component';
import { ApiClientService } from '../core/api-client.service';

const AGE_BAND = {
  id: 'g1',
  medicationId: 'm1',
  medicationEmbodimentId: null,
  source: 'Package insert',
  type: 'age_band' as const,
  mgPerKg: null,
  maxMgPerDose: null,
  maxMgPerDay: 800,
  minIntervalHours: null,
  ageMinMonths: 24,
  ageMaxMonths: 47,
  doseMg: 160,
  doseMl: 5,
  pillCount: null,
  frequencyPerDay: 5,
  notes: null,
};

describe('GuidelineEditorComponent', () => {
  let apiMock: any;

  beforeEach(async () => {
    apiMock = { post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [GuidelineEditorComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => jest.restoreAllMocks());

  function build(guideline: any = null) {
    const fixture = TestBed.createComponent(GuidelineEditorComponent);
    fixture.componentInstance.medicationId = 'm1';
    fixture.componentInstance.guideline = guideline;
    fixture.detectChanges();
    return fixture;
  }

  describe('adding', () => {
    it('swaps the fields when the type changes', () => {
      const comp = build().componentInstance;

      // Regression test for a frozen computed(): reading a form control's plain `.value` inside
      // computed() registers no signal dependency, so the type evaluated once and cached forever.
      expect(comp.isWeightBased()).toBe(true);
      comp.form.controls.type.setValue('age_band');
      expect(comp.isWeightBased()).toBe(false);
    });

    it('requires maxMgPerDay for both types, and the per-type fields', () => {
      const comp = build().componentInstance;

      comp.form.patchValue({ source: 'AAP', type: 'weight_based', mgPerKg: 15, maxMgPerDose: 1000, minIntervalHours: 4 });
      expect(comp.form.invalid).toBe(true);
      comp.form.patchValue({ maxMgPerDay: 4000 });
      expect(comp.form.valid).toBe(true);

      comp.form.controls.type.setValue('age_band');
      expect(comp.form.invalid).toBe(true);
      comp.form.patchValue({ ageMinMonths: 24, ageMaxMonths: 72, doseMg: 160, frequencyPerDay: 4 });
      expect(comp.form.valid).toBe(true);
    });

    it('posts a new guideline', () => {
      apiMock.post.mockReturnValue(of({ id: 'g2' }));
      const comp = build().componentInstance;
      comp.form.patchValue({ source: 'AAP', mgPerKg: 15, maxMgPerDose: 1000, minIntervalHours: 4, maxMgPerDay: 4000 });
      comp.save();
      expect(apiMock.post).toHaveBeenCalledWith(
        '/medications/m1/guidelines',
        expect.objectContaining({ source: 'AAP', type: 'weight_based', mgPerKg: 15, maxMgPerDay: 4000, doseMg: undefined }),
      );
    });

    it('reports a failed create instead of doing nothing, and keeps the form', () => {
      apiMock.post.mockReturnValue(throwError(() => ({ status: 400, error: { message: ['maxMgPerDay must be a number'] } })));
      const comp = build().componentInstance;
      comp.form.patchValue({ source: 'AAP', mgPerKg: 15, maxMgPerDose: 1000, minIntervalHours: 4, maxMgPerDay: 4000 });
      comp.save();

      expect(comp.error()).toBe('Could not add this guideline.');
      expect(comp.saving()).toBe(false);
      expect(comp.form.getRawValue().source).toBe('AAP');
    });
  });

  describe('editing', () => {
    it('shows the type as text with how to change it, not a select', () => {
      const fixture = build(AGE_BAND);
      const text = fixture.nativeElement.textContent;
      expect(fixture.nativeElement.querySelector('select')).toBeNull();
      expect(text).toContain('Age-band');
      expect(text).toContain('delete this guideline and add a new one');
      expect(fixture.componentInstance.isWeightBased()).toBe(false);
    });

    it('PATCHes only the fields that changed', () => {
      apiMock.patch.mockReturnValue(of(AGE_BAND));
      const comp = build(AGE_BAND).componentInstance;

      comp.form.patchValue({ doseMg: 120, source: 'Package insert (2024)' });
      comp.save();
      expect(apiMock.patch).toHaveBeenCalledWith('/guidelines/g1', { source: 'Package insert (2024)', doseMg: 120 });
    });

    it('clears the optional mL dose with null', () => {
      const comp = build(AGE_BAND).componentInstance;
      comp.form.patchValue({ doseMl: null });
      expect(comp.changes()).toEqual({ doseMl: null });
    });

    it('never sends type', () => {
      const comp = build(AGE_BAND).componentInstance;
      comp.form.patchValue({ frequencyPerDay: 4 });
      expect(comp.changes()).not.toHaveProperty('type');
    });

    it('treats an unchanged form as a cancel', () => {
      const fixture = build(AGE_BAND);
      const cancelled = jest.fn();
      fixture.componentInstance.cancelled.subscribe(cancelled);
      fixture.componentInstance.save();
      expect(apiMock.patch).not.toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalled();
    });

    it('shows the age-range error from the merged-row check', () => {
      apiMock.patch.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'GUIDELINE_AGE_RANGE_INVALID' } })));
      const comp = build(AGE_BAND).componentInstance;
      comp.form.patchValue({ ageMinMonths: 60 });
      comp.save();
      expect(comp.error()).toContain('minimum age must be lower');
    });

    it('deletes after a confirm', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(of(undefined));
      const fixture = build(AGE_BAND);
      const deleted = jest.fn();
      fixture.componentInstance.deleted.subscribe(deleted);
      fixture.componentInstance.remove();
      expect(apiMock.delete).toHaveBeenCalledWith('/guidelines/g1');
      expect(deleted).toHaveBeenCalledWith('g1');
    });

    it('reads the dependents back when the guideline is in use', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'GUIDELINE_IN_USE', dependents: { interventions: 2, advisories: 1 } } })),
      );
      const comp = build(AGE_BAND).componentInstance;
      comp.remove();
      expect(comp.inUse()).toContain('cannot be deleted');
      expect(comp.inUseDependents()).toBe('Still used by 2 logged doses and 1 alert.');
    });
  });
});
