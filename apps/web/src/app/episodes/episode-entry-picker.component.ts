import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EpisodeEventRef, Medication, TimelineEntry, TimelineResponse } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { describeEvent, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';

export const PICKER_PAGE_SIZE = 25;

/** `type:id` — the identity of an entry across the observation and intervention tables. */
export const entryKey = (r: { type?: string; kind?: string; id: string }) => `${r.kind ?? r.type}:${r.id}`;

/** A picked entry, with what the parent form needs to say "starts with …" without refetching. */
export interface PickedEntry extends EpisodeEventRef {
  timestamp: number;
  label: string;
}

/**
 * Multi-select over one patient's logged entries, newest first (frontend.md → History → New
 * episode, and Episode detail → Add entries). Loads the patient timeline once — the journal does
 * the same — and pages through it client-side, so "no entries at all" is a definite answer rather
 * than an empty window.
 */
@Component({
  selector: 'app-episode-entry-picker',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="error" *ngIf="error()">{{ error() }}</p>
    <p class="muted" *ngIf="loaded() && !candidates().length && !error()">{{ emptyText() }}</p>

    <ul class="picker" *ngIf="candidates().length">
      <li *ngFor="let e of visible()">
        <label class="pick" [class.checked]="isPicked(e)">
          <input type="checkbox" [checked]="isPicked(e)" (change)="toggle(e)" />
          <span class="when">{{ e.timestamp * 1000 | date: 'MMM d, h:mm a' }}</span>
          <span class="kind">{{ e.kind }}</span>
          <span class="what">{{ describe(e) }}</span>
        </label>
      </li>
    </ul>
    <button
      type="button"
      class="secondary load-earlier"
      *ngIf="visible().length < candidates().length"
      (click)="shown.set(shown() + pageSize)"
    >
      Load earlier
    </button>
  `,
  styles: [
    `
      .picker {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .pick {
        display: grid;
        grid-template-columns: auto auto 1fr;
        grid-template-areas: 'box when kind' 'box what what';
        column-gap: 0.6rem;
        row-gap: 0.15rem;
        align-items: center;
        padding: 0.55rem 0.7rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
        background: var(--surface-raised);
        cursor: pointer;
      }
      .pick.checked {
        border-color: var(--accent);
      }
      .pick input {
        grid-area: box;
        width: 1.15rem;
        height: 1.15rem;
      }
      .when {
        grid-area: when;
        font-weight: 600;
        white-space: nowrap;
      }
      .kind {
        grid-area: kind;
        color: var(--text-muted);
        font-size: 0.85rem;
        text-transform: capitalize;
      }
      .what {
        grid-area: what;
        overflow-wrap: anywhere;
      }
      .load-earlier {
        margin-top: 0.6rem;
      }
    `,
  ],
})
export class EpisodeEntryPickerComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);

  readonly patientId = input.required<string>();
  /** Keys (`entryKey`) of entries not to offer — the episode's current members, on Add entries. */
  readonly exclude = input<Set<string>>(new Set());
  readonly emptyText = input('No entries logged for this patient yet. Log one first, then draw the episode around it.');
  readonly selectionChange = output<PickedEntry[]>();

  readonly pageSize = PICKER_PAGE_SIZE;
  private readonly entries = signal<TimelineEntry[]>([]);
  private readonly medicationNames = signal<Map<string, string>>(new Map());
  private readonly picked = signal<Map<string, PickedEntry>>(new Map());
  readonly shown = signal(PICKER_PAGE_SIZE);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  readonly candidates = computed(() => {
    const exclude = this.exclude();
    return this.entries()
      .filter((e) => e.kind !== 'advisory' && !exclude.has(entryKey(e)))
      .sort((a, b) => b.timestamp - a.timestamp);
  });
  readonly visible = computed(() => this.candidates().slice(0, this.shown()));

  ngOnInit(): void {
    this.api.get<Medication[]>('/medications').subscribe({
      next: (meds) => this.medicationNames.set(new Map(meds.map((m) => [m.id, m.name]))),
      error: () => undefined, // names are a nicety; describeEvent falls back without them
    });
    this.api.get<TimelineResponse>(`/patients/${this.patientId()}/timeline`).subscribe({
      next: (res) => {
        this.entries.set(res.entries);
        this.loaded.set(true);
      },
      error: (err) => this.error.set(errorText(err, 'Could not load this patient’s entries.')),
    });
  }

  describe(e: TimelineEntry): string {
    return describeEvent(e, unitsFor(this.auth.user()), { medicationNames: this.medicationNames() }) || e.type;
  }

  isPicked(e: TimelineEntry): boolean {
    return this.picked().has(entryKey(e));
  }

  toggle(e: TimelineEntry) {
    const next = new Map(this.picked());
    const key = entryKey(e);
    if (next.has(key)) next.delete(key);
    else
      next.set(key, {
        type: e.kind as EpisodeEventRef['type'],
        id: e.id,
        timestamp: e.timestamp,
        label: this.describe(e),
      });
    this.picked.set(next);
    this.selectionChange.emit([...next.values()]);
  }
}
