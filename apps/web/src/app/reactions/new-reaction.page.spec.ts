import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewReactionPage } from './new-reaction.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const CATALOG = [
  { id: 'm1', name: 'amoxicillin', brandNames: [], description: null, tags: ['penicillin'], defaultActive: true, createdAt: 0, updatedAt: 0 },
];

describe('NewReactionPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.includes('/embodiments')) return of([{ id: 'e1', medicationId: 'm1', label: 'suspension' }]);
        return of(CATALOG);
      }),
      post: jest.fn().mockReturnValue(of({ id: 'r1' })),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewReactionPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  function build() {
    const fixture = TestBed.createComponent(NewReactionPage);
    fixture.detectChanges();
    return fixture;
  }

  it('sends exactly one scope target, and omits an unknown date', () => {
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ description: 'throat tingled', severity: 'warning', scopeType: 'medication' });
    comp.onMedicationChange(CATALOG[0] as any);
    comp.save();

    // occurredAt omitted rather than null: an unknown date stores null server-side, and forcing a
    // guess would put a fabricated fact into a record the app keeps forever.
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/reactions', {
      description: 'throat tingled',
      severity: 'warning',
      scopeType: 'medication',
      medicationId: 'm1',
      embodimentId: undefined,
      tag: undefined,
      occurredAt: undefined,
    });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'meds']);
  });

  it('clears the other targets when the scope type changes', () => {
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ description: 'x', scopeType: 'medication' });
    comp.onMedicationChange(CATALOG[0] as any);
    expect(comp.form.getRawValue().medicationId).toBe('m1');

    comp.form.controls.scopeType.setValue('tag');
    comp.onScopeTypeChange();

    // The API's INVALID_REACTION_SCOPE stays a backstop, not the primary UX: the client can never
    // send two targets in the first place.
    expect(comp.form.getRawValue().medicationId).toBe('');
    expect(comp.selectedMedication()).toBeNull();
  });

  it('warns, but still saves, when a tag matches nothing in the catalog', () => {
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.controls.scopeType.setValue('tag');
    comp.onScopeTypeChange();
    comp.form.patchValue({ description: 'hives', tag: 'sulfa' });
    fixture.detectChanges();

    // A tag-scoped reaction only matches a medication's own tags, so a typo silently never fires.
    // Saying so is honest; blocking the save is not -- the class may not be catalogued yet.
    expect(comp.tagMatchesNothing()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("won't match anything");

    comp.save();
    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/reactions',
      expect.objectContaining({ scopeType: 'tag', tag: 'sulfa', medicationId: undefined }),
    );

    comp.form.patchValue({ tag: 'penicillin' });
    expect(comp.tagMatchesNothing()).toBe(false);
  });

  it('sends only embodimentId for a form-scoped reaction', () => {
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.controls.scopeType.setValue('embodiment');
    comp.onScopeTypeChange();
    comp.form.patchValue({ description: 'blistered' });
    comp.onMedicationChange(CATALOG[0] as any);

    // The medication was only how the caregiver found the form, so it must not travel with it:
    // two targets is 400 INVALID_REACTION_SCOPE.
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1/embodiments');
    expect(comp.embodiments().length).toBe(1);

    comp.form.patchValue({ embodimentId: 'e1' });
    comp.save();

    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/reactions',
      expect.objectContaining({ scopeType: 'embodiment', embodimentId: 'e1', medicationId: undefined, tag: undefined }),
    );
  });

  it('drops a form chosen under a previous medication when the medication changes', () => {
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.controls.scopeType.setValue('embodiment');
    comp.onScopeTypeChange();
    comp.onMedicationChange(CATALOG[0] as any);
    comp.form.patchValue({ embodimentId: 'e1' });

    // Clearing via the shared typeahead's "Change" affordance: an embodiment id from the old
    // medication would otherwise be sent as a target that does not belong to the new one.
    comp.onMedicationChange(null);

    expect(comp.selectedMedication()).toBeNull();
    expect(comp.form.getRawValue().embodimentId).toBe('');
    expect(comp.form.getRawValue().medicationId).toBe('');
  });

  it('surfaces a save failure instead of silently doing nothing', () => {
    apiMock.post.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'INVALID_REACTION_SCOPE' } })));
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ description: 'x', scopeType: 'medication' });
    comp.onMedicationChange(CATALOG[0] as any);
    comp.save();

    expect(comp.error()).toBeTruthy();
    expect(comp.saving()).toBe(false);
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });
});
