import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MedicationHeaderEditorComponent, splitList } from './medication-header-editor.component';
import { ApiClientService } from '../core/api-client.service';
import { dependentsText } from './catalog-dependents';

const MED = {
  id: 'm1',
  name: 'psuedophedrine',
  brandNames: ['Sudafed'],
  description: null,
  tags: ['decongestant', 'sympathomimetic'],
  defaultActive: true,
  createdAt: 0,
  updatedAt: 0,
};

describe('MedicationHeaderEditorComponent', () => {
  let apiMock: any;

  beforeEach(async () => {
    apiMock = { patch: jest.fn(), delete: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [MedicationHeaderEditorComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => jest.restoreAllMocks());

  function build(medication: any = MED) {
    const fixture = TestBed.createComponent(MedicationHeaderEditorComponent);
    fixture.componentInstance.medication = medication;
    fixture.detectChanges();
    return fixture;
  }

  function button(fixture: any, text: string): HTMLButtonElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === text,
    );
  }

  it('prefills the form, lists as comma-separated text', () => {
    const comp = build().componentInstance;
    expect(comp.form.getRawValue()).toEqual({
      name: 'psuedophedrine',
      brandNames: 'Sudafed',
      description: '',
      tags: 'decongestant, sympathomimetic',
      defaultActive: true,
    });
  });

  it('renames with a PATCH carrying only the name', () => {
    apiMock.patch.mockReturnValue(of({ ...MED, name: 'pseudoephedrine' }));
    const fixture = build();
    const saved = jest.fn();
    fixture.componentInstance.saved.subscribe(saved);

    fixture.componentInstance.form.patchValue({ name: ' pseudoephedrine ' });
    fixture.componentInstance.save();

    expect(apiMock.patch).toHaveBeenCalledWith('/medications/m1', { name: 'pseudoephedrine' });
    expect(saved).toHaveBeenCalled();
  });

  it('normalises brand names and tags the way the create form does', () => {
    const comp = build().componentInstance;
    comp.form.patchValue({ brandNames: ' Sudafed , , Sudafed 12 Hour ', tags: 'decongestant,, sympathomimetic ' });
    // Tags unchanged once normalised, so only the brand names go.
    expect(comp.changes()).toEqual({ brandNames: ['Sudafed', 'Sudafed 12 Hour'] });
  });

  it('sends defaultActive and a cleared description', () => {
    const comp = build({ ...MED, description: 'old' }).componentInstance;
    comp.form.patchValue({ defaultActive: false, description: '  ' });
    expect(comp.changes()).toEqual({ description: null, defaultActive: false });
  });

  it('treats an unchanged form as a cancel', () => {
    const fixture = build();
    const cancelled = jest.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.componentInstance.save();
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
  });

  it('shows a taken name by the name field and keeps what was typed', () => {
    apiMock.patch.mockReturnValue(throwError(() => ({ status: 409, error: { message: 'MEDICATION_NAME_TAKEN' } })));
    const fixture = build();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ name: 'ibuprofen' });
    comp.save();
    fixture.detectChanges();

    expect(comp.nameError()).toContain('already in your list');
    expect(comp.error()).toBeNull();
    expect(comp.form.getRawValue().name).toBe('ibuprofen');
    expect(comp.saving()).toBe(false);
  });

  it('disables Save while the request is in flight', () => {
    apiMock.patch.mockReturnValue({ subscribe: () => undefined });
    const fixture = build();
    fixture.componentInstance.form.patchValue({ name: 'x' });
    fixture.componentInstance.save();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  describe('tag caution', () => {
    it('says nothing while no current tag is being removed', () => {
      const fixture = build();
      fixture.componentInstance.form.patchValue({ tags: 'decongestant, sympathomimetic, otc' });
      fixture.detectChanges();
      expect(fixture.componentInstance.removedTags()).toEqual([]);
      expect(fixture.nativeElement.textContent).not.toContain("You're removing");
    });

    it('cautions, without blocking, when an edit would remove a tag', () => {
      apiMock.patch.mockReturnValue(of(MED));
      const fixture = build();
      fixture.componentInstance.form.patchValue({ tags: 'decongestant' });
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain("You're removing sympathomimetic");
      fixture.componentInstance.save();
      expect(apiMock.patch).toHaveBeenCalledWith('/medications/m1', { tags: ['decongestant'] });
    });

    it('does not count a change of case as a removal', () => {
      const comp = build().componentInstance;
      comp.form.patchValue({ tags: 'Decongestant, sympathomimetic' });
      expect(comp.removedTags()).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes after a confirm', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(of(undefined));
      const fixture = build();
      const deleted = jest.fn();
      fixture.componentInstance.deleted.subscribe(deleted);
      fixture.componentInstance.remove();
      expect(window.confirm).toHaveBeenCalledWith('Delete psuedophedrine? This cannot be undone.');
      expect(deleted).toHaveBeenCalledWith('m1');
    });

    it('does nothing when the confirm is declined', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      build().componentInstance.remove();
      expect(apiMock.delete).not.toHaveBeenCalled();
    });

    it('reads the dependents back and offers to mark it inactive instead', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { message: 'MEDICATION_IN_USE', dependents: { embodiments: 2, interventions: 14 } },
        })),
      );
      const fixture = build();
      fixture.componentInstance.remove();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Still used by 2 forms and 14 logged doses.');
      const retire = button(fixture, 'Mark inactive instead');
      expect(retire).toBeTruthy();

      apiMock.patch.mockReturnValue(of({ ...MED, defaultActive: false }));
      retire!.click();
      expect(apiMock.patch).toHaveBeenCalledWith('/medications/m1', { defaultActive: false });
    });

    it('does not offer to retire a medication that is already inactive', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      apiMock.delete.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'MEDICATION_IN_USE', dependents: { interventions: 1 } } })),
      );
      const fixture = build({ ...MED, defaultActive: false });
      fixture.componentInstance.remove();
      fixture.detectChanges();
      expect(button(fixture, 'Mark inactive instead')).toBeUndefined();
      expect(fixture.nativeElement.textContent).toContain('already inactive');
    });
  });
});

describe('splitList', () => {
  it('trims and drops empties', () => {
    expect(splitList(' a, ,b ,')).toEqual(['a', 'b']);
    expect(splitList('')).toEqual([]);
  });
});

describe('dependentsText', () => {
  it('reads counts back in words, keeping keys it does not know', () => {
    expect(dependentsText({ schedules: 1 })).toBe('Still used by 1 schedule.');
    expect(dependentsText({ reactions: 2, schedules: 1, mystery: 3 })).toBe(
      'Still used by 2 recorded reactions, 1 schedule and 3 other records.',
    );
    expect(dependentsText(null)).toBeNull();
    expect(dependentsText({})).toBeNull();
  });
});
