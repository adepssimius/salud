import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { CatalogSeedPreview } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { CatalogSeedPreviewComponent } from './catalog-seed-preview.component';

const PREVIEW: CatalogSeedPreview = {
  sourceUrl: 'https://example.test/medication-catalog.json',
  sourceHash: 'a'.repeat(64),
  fetchedAt: 1_700_000_000,
  newMedications: [
    { selectionId: 'miconazole', name: 'Miconazole', brandNames: [], tags: ['antifungal'], embodimentLabels: ['4% vaginal cream (25 g tube)'], guidelineCount: 0 },
  ],
  newEmbodiments: [
    { selectionId: 'acetaminophen/tablet-500mg', medicationId: 'm1', medicationName: 'acetaminophen', label: '500 mg tablet', unitType: 'tablet', guidelineCount: 0 },
  ],
  newGuidelines: [],
  present: [
    {
      kind: 'medication',
      selectionId: 'acetaminophen',
      id: 'm1',
      medicationName: 'acetaminophen',
      label: 'acetaminophen',
      differences: [{ field: 'description', database: 'Ours', file: 'Antipyretic and analgesic.' }],
    },
  ],
};

function conflict(code: string) {
  return throwError(() => new HttpErrorResponse({ status: 409, error: { message: code, statusCode: 409 } }));
}

describe('CatalogSeedPreviewComponent', () => {
  let api: { post: jest.Mock };

  beforeEach(async () => {
    api = { post: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [CatalogSeedPreviewComponent],
      providers: [{ provide: ApiClientService, useValue: api }],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(CatalogSeedPreviewComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('previews on open with every offered item ticked, and present items not selectable', () => {
    api.post.mockReturnValue(of(PREVIEW));
    const fixture = create();
    const comp = fixture.componentInstance;
    expect(api.post).toHaveBeenCalledWith('/medications/catalog-seed/preview', {});
    expect([...comp.selected()].sort()).toEqual(['acetaminophen/tablet-500mg', 'miconazole']);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('New medications');
    expect(text).toContain('Already in your list (1)');
    expect(text).toContain('Description differs');
    expect(text).toContain('Add selected (2)');
    // Two checkboxes: the two offered items. The present medication has none.
    expect(fixture.nativeElement.querySelectorAll('input[type=checkbox]').length).toBe(2);
  });

  it('applies only what is still ticked, with the previewed hash, and reports in words', () => {
    api.post.mockReturnValueOnce(of(PREVIEW));
    const fixture = create();
    const comp = fixture.componentInstance;
    const applied = jest.fn();
    comp.applied.subscribe(applied);

    comp.toggle('acetaminophen/tablet-500mg');
    api.post
      .mockReturnValueOnce(of({ added: ['miconazole'], skipped: [] }))
      .mockReturnValueOnce(of({ ...PREVIEW, newMedications: [] }));
    comp.apply();

    expect(api.post).toHaveBeenNthCalledWith(2, '/medications/catalog-seed/apply', {
      sourceHash: PREVIEW.sourceHash,
      select: ['miconazole'],
    });
    expect(comp.resultText()).toBe('Added 1 medication.');
    expect(applied).toHaveBeenCalled();
    // Re-previews afterwards so the panel shows what is left.
    expect(api.post).toHaveBeenNthCalledWith(3, '/medications/catalog-seed/preview', {});
  });

  it('names items someone else added meanwhile', () => {
    api.post.mockReturnValueOnce(of(PREVIEW));
    const comp = create().componentInstance;
    api.post
      .mockReturnValueOnce(
        of({ added: ['miconazole'], skipped: [{ selectionId: 'acetaminophen/tablet-500mg', reason: 'already_present' }] }),
      )
      .mockReturnValueOnce(of(PREVIEW));
    comp.apply();
    expect(comp.resultText()).toBe('Added 1 medication. 1 item was already added by someone else.');
  });

  it('on CATALOG_SEED_CHANGED drops the stale preview and says to preview again, never re-applying', () => {
    api.post.mockReturnValueOnce(of(PREVIEW));
    const fixture = create();
    const comp = fixture.componentInstance;
    api.post.mockReturnValueOnce(conflict('CATALOG_SEED_CHANGED'));
    comp.apply();
    fixture.detectChanges();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(comp.preview()).toBeNull();
    expect(comp.error()).toMatch(/changed after you previewed it/);
    expect(fixture.nativeElement.textContent).toContain('Preview again');
  });

  it('says so when there is nothing to add', () => {
    api.post.mockReturnValue(of({ ...PREVIEW, newMedications: [], newEmbodiments: [] }));
    const fixture = create();
    expect(fixture.nativeElement.textContent).toContain('Your list already has everything in the repo catalog.');
    expect(fixture.nativeElement.textContent).not.toContain('Add selected');
  });
});
