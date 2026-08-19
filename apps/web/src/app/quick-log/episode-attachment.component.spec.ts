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
}

describe('EpisodeAttachmentComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  function render(episodes: Array<{ id: string; name: string }>, selectedIds: string[] = []) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.episodes = episodes;
    fixture.componentInstance.selectedIds = selectedIds;
    fixture.detectChanges();
    return fixture;
  }

  it('renders the single pre-attached episode as a removable chip', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever – Aug 2026' }], ['ep1']);
    const el = fixture.nativeElement as HTMLElement;
    // The whole phrase, not its halves: asserting 'Adding to' and the name separately passes
    // happily on "Adding toFever – Aug 2026", which is what Angular's whitespace collapsing
    // actually rendered until the &ngsp; in the template.
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

  it('keeps "start new episode" and "this resolves…" behind the More disclosure', () => {
    const fixture = render([{ id: 'ep1', name: 'Fever' }], ['ep1']);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Start a new episode');

    const more = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'More');
    more!.click();
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

  it('renders nothing when the patient has no active episodes', () => {
    const fixture = render([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.episode-attachment')).toBeNull();
  });
});
