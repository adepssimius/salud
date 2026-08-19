import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface EpisodeOption {
  id: string;
  name: string;
}

/**
 * Episode attachment for the two entry forms.
 *
 * **A visible default, never a silent inference (P5).** One active episode is pre-attached as a
 * removable chip — zero taps in the common case — but the attachment sits on screen for the
 * caregiver to reject before saving, so the judgment stays theirs. Two or more active episodes get
 * a chip picker with nothing pre-selected: the app does not guess which illness a 3 AM dose
 * belongs to.
 *
 * "Start new episode" and "this resolves…" live behind a "More" disclosure. Resolution is still
 * only ever a side effect of a logged event — it just stops occupying prime space on every entry
 * (frontend.md → "Information architecture (v2)" → Quick Log).
 *
 * The pre-attach itself is applied by the parent when it loads the episode list, not here: the
 * parent owns the form state, and a component that patched its own inputs would fight the
 * `resolveEpisodeId` deep link the episode-detail page arrives with.
 */
@Component({
  selector: 'app-episode-attachment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="episode-attachment" *ngIf="episodes.length || createNew">
      <ng-container *ngIf="isSingle(); else picker">
        <div class="attached" *ngIf="isSelected(episodes[0].id); else reattach">
          <!-- &ngsp; not a plain space: Angular's default whitespace collapsing trims the trailing
               space off this text node, and the chip renders "Adding toFever". -->
          <span class="pill">
            Adding to&ngsp;<strong>{{ episodes[0].name }}</strong>
          </span>
          <button
            type="button"
            class="link chip-remove"
            [attr.aria-label]="'Detach from ' + episodes[0].name"
            (click)="toggle(episodes[0].id)"
          >
            ✕
          </button>
        </div>
        <ng-template #reattach>
          <button type="button" class="chip" (click)="toggle(episodes[0].id)">
            Add to {{ episodes[0].name }}
          </button>
        </ng-template>
      </ng-container>

      <ng-template #picker>
        <span class="muted small">Attach to an episode</span>
        <div class="chip-row">
          <button
            type="button"
            class="chip"
            *ngFor="let ep of episodes"
            [class.chip-on]="isSelected(ep.id)"
            [attr.aria-pressed]="isSelected(ep.id)"
            (click)="toggle(ep.id)"
          >
            {{ ep.name }}
          </button>
        </div>
      </ng-template>

      <button type="button" class="link small" (click)="moreOpen.set(!moreOpen())">
        {{ moreOpen() ? 'Less' : 'More' }}
      </button>

      <div class="more" *ngIf="moreOpen()">
        <label class="inline-check">
          <input type="checkbox" [checked]="createNew" (change)="onCreateNewToggle($event)" />
          <span>Start a new episode</span>
        </label>
        <label class="field" *ngIf="createNew">
          <span>New episode name</span>
          <input
            type="text"
            [ngModel]="newEpisodeName"
            (ngModelChange)="newEpisodeNameChange.emit($event)"
            [ngModelOptions]="{ standalone: true }"
            placeholder="e.g. Fever"
          />
        </label>
        <label class="inline-check" *ngIf="selectedIds.length">
          <input type="checkbox" [checked]="resolveSelected" (change)="onResolveToggle($event)" />
          <span>This resolves the selected episode{{ selectedIds.length > 1 ? 's' : '' }}</span>
        </label>
      </div>
    </div>
  `,
  styles: [
    `
      .episode-attachment {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.4rem;
      }
      .attached {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .chip-remove {
        font-size: 0.85rem;
        line-height: 1;
      }
      .more {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
      }
    `,
  ],
})
export class EpisodeAttachmentComponent {
  @Input() episodes: EpisodeOption[] = [];
  @Input() selectedIds: string[] = [];
  @Input() createNew = false;
  @Input() newEpisodeName = '';
  @Input() resolveSelected = false;

  @Output() selectedIdsChange = new EventEmitter<string[]>();
  @Output() createNewChange = new EventEmitter<boolean>();
  @Output() newEpisodeNameChange = new EventEmitter<string>();
  @Output() resolveSelectedChange = new EventEmitter<boolean>();

  moreOpen = signal(false);

  // A getter, not a computed: `episodes` is a plain @Input, so a computed would cache the value it
  // saw on first render and never see the list arrive.
  isSingle(): boolean {
    return this.episodes.length === 1;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggle(id: string) {
    const next = this.isSelected(id)
      ? this.selectedIds.filter((x) => x !== id)
      : [...this.selectedIds, id];
    this.selectedIdsChange.emit(next);
    // `resolvesEpisodeIds ⊆ episodeIds` is a service-side invariant; detaching the last episode
    // while "this resolves…" is still ticked would post a body that violates it.
    if (!next.length && this.resolveSelected) this.resolveSelectedChange.emit(false);
  }

  onCreateNewToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.createNewChange.emit(checked);
    if (!checked) this.newEpisodeNameChange.emit('');
  }

  onResolveToggle(event: Event) {
    this.resolveSelectedChange.emit((event.target as HTMLInputElement).checked);
  }
}
