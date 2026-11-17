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
 * "Start new episode" and "this resolves…" live behind a "More" disclosure, which renders even
 * with zero active episodes — that is the state a first episode starts from. Resolution is still
 * only ever a side effect of a logged event — it just stops occupying prime space on every entry
 * (frontend.md → "Information architecture (v2)" → Quick Log).
 *
 * The pre-attach itself is applied by the parent when it loads the episode list, not here: the
 * parent owns the form state, and a component that patched its own inputs would fight the
 * `resolveEpisodeId` deep link the episode-detail page arrives with.
 *
 * **Correcting an entry** (frontend.md → "Correcting an entry") configures two things the create
 * forms leave at their defaults:
 * - `allowCreateNew = false` drops "Start a new episode" — a correction fixes what was recorded,
 *   it does not open a frame. With nothing else to disclose, "this resolves…" then renders inline
 *   rather than behind a More that would open onto a single checkbox (or onto nothing).
 * - `unresolvableIds` are episodes this entry is the earliest entry of. They select and deselect
 *   like any other — unlinking the start just moves it to the next-earliest entry (data-model.md →
 *   "An episode starts at its earliest entry") — but are left out of what "this resolves…" counts:
 *   the earliest entry resolving its own episode would end it at its start.
 *
 * `lockedIds` (selected, not toggleable, never emitted as deselected, not resolvable) is the
 * general form; nothing passes it since an entry may leave the episode it started.
 */
@Component({
  selector: 'app-episode-attachment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Always rendered. With no active episode there is nothing to attach to, but "Start a new
         episode" is the *only* way an episode ever begins (no create endpoint — CLAUDE.md →
         Episode model), so the More disclosure has to stay reachable in exactly that state. -->
    <div class="episode-attachment">
      <ng-container *ngIf="isSingle(); else picker">
        <div class="attached" *ngIf="isSelected(episodes[0].id); else reattach">
          <!-- &nbsp;, and it has to be that rather than a plain space or the &ngsp; that was here
               before. The chip rendered "Adding toFever" and whitespace collapsing was never the
               cause: .pill is an inline-flex box, so this text and the <strong> are two flex items,
               and flex strips *collapsible* white space from the ends of a text item. A no-break
               space is not collapsible, so it survives — and unlike a CSS gap it is a real
               character, which is what a screen reader reads out and what copies to the clipboard.
               The spec asserts the whole phrase for exactly this reason. -->
          <span class="pill">
            Adding to&nbsp;<strong>{{ episodes[0].name }}</strong>
          </span>
          <button
            *ngIf="!isLocked(episodes[0].id)"
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
        <ng-container *ngIf="episodes.length">
          <span class="muted small">Attach to an episode</span>
          <div class="chip-row">
            <button
              type="button"
              class="chip"
              *ngFor="let ep of episodes"
              [class.chip-on]="isSelected(ep.id)"
              [class.chip-locked]="isLocked(ep.id)"
              [disabled]="isLocked(ep.id)"
              [attr.aria-pressed]="isSelected(ep.id)"
              (click)="toggle(ep.id)"
            >
              {{ ep.name }}
            </button>
          </div>
        </ng-container>
      </ng-template>

      <span class="muted small locked-note" *ngIf="hasLockedEpisode()">This entry started this episode</span>

      <ng-container *ngIf="allowCreateNew; else resolveOnly">
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
        <ng-container *ngTemplateOutlet="resolveOption"></ng-container>
      </div>
      </ng-container>

      <!-- No "Start a new episode" to disclose: the resolve option stands on its own, and with no
           resolvable episode nothing renders at all — no More opening onto an empty panel. -->
      <ng-template #resolveOnly>
        <ng-container *ngTemplateOutlet="resolveOption"></ng-container>
      </ng-template>

      <ng-template #resolveOption>
        <label class="inline-check" *ngIf="resolvableIds().length">
          <input type="checkbox" [checked]="resolveSelected" (change)="onResolveToggle($event)" />
          <span>This resolves the selected episode{{ resolvableIds().length > 1 ? 's' : '' }}</span>
        </label>
      </ng-template>
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
        /* An episode name is the caregiver's own sentence and can be long. On a phone the chip and
           its detach button wrap rather than run off the form. */
        flex-wrap: wrap;
      }
      /* A bare ✕ glyph measured 11px across. The character stays small; the button around it is
         what the thumb has to find, and detaching the wrong episode is a real cost. */
      .chip-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.75rem;
        min-height: 1.75rem;
        font-size: 0.85rem;
        line-height: 1;
      }
      /* A locked chip is selected and stays that way; it must not read as a dimmed, unselected one. */
      .chip-locked:disabled {
        opacity: 1;
        cursor: default;
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
  /** False on a correction: no "Start a new episode" (see the class comment). */
  @Input() allowCreateNew = true;
  /** Episodes that stay selected whatever the caregiver taps — on a correction, the one it started. */
  @Input() lockedIds: string[] = [];
  /** Selectable, but never counted by "this resolves…" — see the class comment. */
  @Input() unresolvableIds: string[] = [];

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

  isLocked(id: string): boolean {
    return this.lockedIds.includes(id);
  }

  hasLockedEpisode(): boolean {
    return this.episodes.some((ep) => this.isLocked(ep.id));
  }

  /** Selected episodes "this resolves…" applies to — never a locked or unresolvable one. */
  resolvableIds(): string[] {
    return this.selectedIds.filter((id) => this.isResolvable(id));
  }

  private isResolvable(id: string): boolean {
    return !this.isLocked(id) && !this.unresolvableIds.includes(id);
  }

  toggle(id: string) {
    if (this.isLocked(id)) return;
    const next = this.isSelected(id)
      ? this.selectedIds.filter((x) => x !== id)
      : [...this.selectedIds, id];
    this.selectedIdsChange.emit(next);
    // `resolvesEpisodeIds ⊆ episodeIds` is a service-side invariant; detaching the last episode
    // while "this resolves…" is still ticked would post a body that violates it.
    if (!next.some((x) => this.isResolvable(x)) && this.resolveSelected) this.resolveSelectedChange.emit(false);
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
