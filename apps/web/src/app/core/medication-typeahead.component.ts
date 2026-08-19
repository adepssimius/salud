import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Medication } from '@salud/shared/types';
import { ApiClientService } from './api-client.service';

/**
 * Search-and-pick over `GET /api/medications?q=` — the input a caregiver uses to name a medication,
 * wherever they have to name one (frontend.md → "Reactions" → Scope picker, which specifies "the
 * same typeahead used by the dose and schedule forms").
 *
 * Extracted from the copy that grew inside reaction entry (ISSUES.md #29). Dose entry, schedule
 * entry and the quick-log sheet still carry their own copies; they are not migrated here because
 * swapping four call sites in the same change as a feature would make both harder to review. This
 * component is the destination for that migration, not a fifth copy.
 */
@Component({
  selector: 'app-medication-typeahead',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="field med-search" *ngIf="!selected; else chosen">
      <span>{{ label }}</span>
      <input
        type="text"
        [value]="query()"
        (input)="onQueryChange($event)"
        [placeholder]="placeholder"
      />
      <ul class="med-results" *ngIf="results().length">
        <li *ngFor="let m of results()">
          <button type="button" class="med-result" (click)="choose(m)">
            {{ m.name }}
            <span class="muted small" *ngIf="m.brandNames?.length"> — {{ m.brandNames.join(', ') }}</span>
          </button>
        </li>
      </ul>
    </div>

    <ng-template #chosen>
      <div class="chosen-med">
        <span>{{ selected?.name }}</span>
        <button type="button" class="link" (click)="clear()">Change</button>
      </div>
    </ng-template>
  `,
  styles: [
    `
      .med-search {
        position: relative;
      }
      /* Absolutely positioned so the results don't shove the rest of the form down and back up on
         every keystroke -- the fields below would otherwise move under the caregiver's thumb. */
      .med-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 10;
        list-style: none;
        margin: 0.25rem 0 0;
        padding: 0.25rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
        max-height: 220px;
        overflow-y: auto;
      }
      .med-result {
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.6rem;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .med-result:hover {
        background: var(--neutral-bg);
      }
      .chosen-med {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
      }
    `,
  ],
})
export class MedicationTypeaheadComponent {
  private readonly api = inject(ApiClientService);

  /** The chosen medication, owned by the host so it can clear the selection when its form resets. */
  @Input() selected: Medication | null = null;
  @Input() label = 'Medication';
  @Input() placeholder = 'Search by name or brand';

  @Output() selectedChange = new EventEmitter<Medication | null>();

  query = signal('');
  results = signal<Medication[]>([]);

  onQueryChange(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.query.set(q);
    if (!q) {
      this.results.set([]);
      return;
    }
    this.api.get<Medication[]>('/medications', { q }).subscribe({
      // A failed search shows no results rather than an error: the caregiver's next keystroke
      // retries it anyway, and an error line here would outlive the query that caused it.
      next: (res) => this.results.set(res),
      error: () => this.results.set([]),
    });
  }

  choose(medication: Medication) {
    this.results.set([]);
    this.query.set('');
    this.selectedChange.emit(medication);
  }

  clear() {
    this.results.set([]);
    this.query.set('');
    this.selectedChange.emit(null);
  }
}
