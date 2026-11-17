import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { EpisodeAttachmentComponent } from './episode-attachment.component';

@Component({
  standalone: true,
  imports: [EpisodeAttachmentComponent],
  template: `
    <app-episode-attachment
      [episodes]="episodes"
      [selectedIds]="selectedIds"
      [createNew]="createNew"
      [resolveSelected]="resolveSelected"
      [allowCreateNew]="allowCreateNew"
      [behindMore]="behindMore"
      [lockedIds]="lockedIds"
      (selectedIdsChange)="selectedIds = $event"
      (createNewChange)="createNew = $event"
      (resolveSelectedChange)="resolveSelected = $event"
    ></app-episode-attachment>
  `,
})
class HostComponent {
  episodes: Array<{ id: string; name: string }> = [];
  selectedIds: string[] = [];
  createNew = false;
  resolveSelected = false;
  allowCreateNew = true;
  behindMore = false;
  lockedIds: string[] = [];
}

describe('EpisodeAttachmentComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  function render(
    episodes: Array<{ id: string; name: string }>,
    selectedIds: string[] = [],
    behindMore = false,
  ) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.episodes = episodes;
    fixture.componentInstance.selectedIds = selectedIds;
    fixture.componentInstance.behindMore = behindMore;
    fixture.detectChanges();
    return fixture;
  }

  it('renders the single pre-attached episode as a removable chip', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever – Aug 2026' }], ['ep1']);
    const el = fixture.nativeElement as HTMLElement;
    // The whole phrase, not its halves: asserting 'Adding to' and the name separately passes
    // happily on "Adding toFever – Aug 2026", which is what the chip actually rendered for a
    // while. The cause was not whitespace collapsing (the &ngsp; that used to sit here never
    // helped) — .pill is an inline-flex box and flex strips collapsible white space off the ends
    // of a text item. The &nbsp; in the template is what survives it. JS \s matches U+00A0, so
    // the normalization below still reduces it to the plain space this asserts.
    expect(el.querySelector('.pill')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Adding to Fever – Aug 2026',
    );
    expect(el.querySelector('.chip-remove')).not.toBeNull();
  });

  // The attachment sits on screen for the caregiver to reject before saving, so the judgment
  // stays theirs (P5).
  it('detaches when the caregiver rejects the default', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever' }], ['ep1']);
    (fixture.nativeElement.querySelector('.chip-remove') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Add to Fever');
  });

  it('offers a picker with nothing pre-selected when several episodes are active', () => {
    const fixture = render([
      { id: 'ep1', name: 'Fever' },
      { id: 'ep2', name: 'Ear infection' },
    ]);
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.chip-row .chip');
    expect(chips.length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.chip-on')).toBeNull();

    (chips[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds).toEqual(['ep2']);
  });

  const moreButton = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).find((b) => ['More', 'Less'].includes(b.textContent!.trim()));

  // frontend.md → Quick Log → "Episode attachment": on the full forms the start control is never
  // tucked away — a caregiver who could not see it concluded episodes could not be started at all.
  describe('on a full form', () => {
    it('shows "Start a new episode" and "this resolves…" with no More to open', () => {
      const el = render([{ id: 'ep1', name: 'Fever' }], ['ep1']).nativeElement as HTMLElement;
      expect(moreButton(el)).toBeUndefined();
      expect(el.textContent).toContain('Start a new episode');
      expect(el.textContent).toContain('This resolves the selected episode');
    });

    it('shows "Start a new episode" beside a multi-episode picker', () => {
      const el = render([
        { id: 'ep1', name: 'Fever' },
        { id: 'ep2', name: 'Rash' },
      ]).nativeElement as HTMLElement;
      expect(moreButton(el)).toBeUndefined();
      expect(el.textContent).toContain('Start a new episode');
      // Nothing selected, so nothing to resolve.
      expect(el.textContent).not.toContain('This resolves');
    });

    it('shows "Start a new episode" on its own when the patient has no active episodes', () => {
      const fixture = render([]);
      const el = fixture.nativeElement as HTMLElement;
      expect(moreButton(el)).toBeUndefined();
      expect(el.querySelector('.chip')).toBeNull();
      expect(el.textContent).toContain('Start a new episode');
      expect(el.textContent).not.toContain('New episode name');

      (el.querySelector('.more input[type="checkbox"]') as HTMLInputElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.createNew).toBe(true);
      expect(el.textContent).toContain('New episode name');
    });
  });

  // The compact quick-log layouts stay minimal.
  it('keeps "start new episode" and "this resolves…" behind More when behindMore is set', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever' }], ['ep1'], true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Start a new episode');

    moreButton(el)!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Start a new episode');
    expect(el.textContent).toContain('This resolves the selected episode');
  });

  // `resolvesEpisodeIds ⊆ episodeIds` is a service-side invariant; detaching the last episode with
  // "this resolves…" still ticked would post a body that violates it.
  it('drops the resolve flag when the last episode is detached', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever' }], ['ep1']);
    fixture.componentInstance.resolveSelected = true;
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.chip-remove') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.resolveSelected).toBe(false);
  });

  // A quiet patient is precisely the one whose first episode is about to start, and logging an
  // event with `startEpisodeName` is the only way an episode begins. This used to render nothing
  // at all, which left no way to start an episode from the UI.
  it('still offers "Start a new episode" behind More when the patient has no active episodes', () => {
    const fixture = render([], [], true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.chip')).toBeNull();
    expect(el.textContent).not.toContain('Attach to an episode');

    const more = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'More');
    expect(more).toBeDefined();
    more!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Start a new episode');
    // Nothing selected, so there is nothing to resolve.
    expect(el.textContent).not.toContain('This resolves');

    (el.querySelector('.more input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.createNew).toBe(true);
    expect(el.textContent).toContain('New episode name');
  });

  // Correcting an entry (frontend.md → "Correcting an entry"): no new episode, and the episode the
  // entry started stays attached.
  describe('as configured by a correction form', () => {
    function renderCorrection(
      episodes: Array<{ id: string; name: string }>,
      selectedIds: string[],
      lockedIds: string[] = [],
    ) {
      const fixture = TestBed.createComponent(HostComponent);
      Object.assign(fixture.componentInstance, { episodes, selectedIds, lockedIds, allowCreateNew: false });
      fixture.detectChanges();
      return fixture;
    }
    const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];

    it('offers no "Start a new episode" and no More disclosure', () => {
      const el = renderCorrection([{ id: 'ep1', name: 'Fever' }, { id: 'ep2', name: 'Rash' }], ['ep2'])
        .nativeElement as HTMLElement;
      expect(el.textContent).not.toMatch(/start a new episode/i);
      expect(buttons(el).some((b) => ['More', 'Less'].includes(b.textContent!.trim()))).toBe(false);
      // The resolve option, its only remaining disclosure, renders inline instead.
      expect(el.textContent).toContain('This resolves the selected episode');
    });

    it('renders nothing dangling with no episodes at all', () => {
      const el = renderCorrection([], []).nativeElement as HTMLElement;
      expect(buttons(el).length).toBe(0);
      expect(el.querySelector('input')).toBeNull();
      expect(el.textContent!.trim()).toBe('');
    });

    it('holds a locked episode in the picker: selected, not toggleable, never emitted as deselected', () => {
      const fixture = renderCorrection(
        [{ id: 'ep1', name: 'Fever' }, { id: 'ep2', name: 'Rash' }],
        ['ep1'],
        ['ep1'],
      );
      const el = fixture.nativeElement as HTMLElement;
      const fever = buttons(el).find((b) => b.textContent!.trim() === 'Fever')!;
      expect(fever.classList).toContain('chip-on');
      expect(fever.disabled).toBe(true);
      expect(el.textContent).toContain('This entry started this episode');

      fever.click();
      (fixture.debugElement.children[0].componentInstance as EpisodeAttachmentComponent).toggle('ep1');
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedIds).toEqual(['ep1']);

      // Other chips still toggle, and the lock survives the round trip.
      buttons(el).find((b) => b.textContent!.trim() === 'Rash')!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedIds).toEqual(['ep1', 'ep2']);
      buttons(el).find((b) => b.textContent!.trim() === 'Rash')!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedIds).toEqual(['ep1']);
    });

    it('holds the lock in the single-episode "attached" branch too', () => {
      const fixture = renderCorrection([{ id: 'ep1', name: 'Fever' }], ['ep1'], ['ep1']);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.pill')!.textContent).toContain('Fever');
      expect(el.querySelector('.chip-remove')).toBeNull();
      expect(el.textContent).toContain('This entry started this episode');

      (fixture.debugElement.children[0].componentInstance as EpisodeAttachmentComponent).toggle('ep1');
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedIds).toEqual(['ep1']);
      // A locked episode is not something this entry can resolve, so there is nothing to offer.
      expect(el.textContent).not.toContain('This resolves');
    });

    it('drops the resolve flag when the last unlocked episode is detached', () => {
      const fixture = renderCorrection(
        [{ id: 'ep1', name: 'Fever' }, { id: 'ep2', name: 'Rash' }],
        ['ep1', 'ep2'],
        ['ep1'],
      );
      fixture.componentInstance.resolveSelected = true;
      fixture.detectChanges();
      buttons(fixture.nativeElement).find((b) => b.textContent!.trim() === 'Rash')!.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedIds).toEqual(['ep1']);
      expect(fixture.componentInstance.resolveSelected).toBe(false);
    });
  });
});
