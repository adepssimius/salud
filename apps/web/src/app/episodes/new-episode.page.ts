import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Condition, CreateEpisodeRequest, Episode } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { EpisodeEntryPickerComponent, PickedEntry } from './episode-entry-picker.component';

/**
 * Same order the API uses to pick the start (api.md → POST /patients/:id/episodes): clinical time,
 * then observation before intervention, then id. The form says which entry that is before saving,
 * so the anchor is never a surprise.
 */
export function byClinicalTime(a: PickedEntry, b: PickedEntry): number {
  return (
    a.timestamp - b.timestamp ||
    (a.type === b.type ? 0 : a.type === 'observation' ? -1 : 1) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Draw an episode around entries already logged (frontend.md → History → New episode). The frame
 * is the caregiver's call (P5): they name it and choose what belongs; the app only reports which
 * chosen entry becomes the start.
 */
@Component({
  selector: 'app-new-episode-page',
  standalone: true,
  imports: [CommonModule, FormsModule, EpisodeEntryPickerComponent],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="back()">&larr; History</button>
      <h1>New episode</h1>
      <p class="muted">Name the stretch of time and choose the entries that belong to it.</p>

      <form (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Name</span>
          <input type="text" name="name" [(ngModel)]="name" placeholder="e.g. Flu Oct 2026" maxlength="200" />
        </label>

        <label class="field" *ngIf="conditions().length">
          <span>Condition (optional)</span>
          <select name="conditionId" [(ngModel)]="conditionId">
            <option [ngValue]="null">None</option>
            <option *ngFor="let c of conditions()" [ngValue]="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label class="field">
          <span>Notes (optional)</span>
          <textarea rows="2" name="notes" [(ngModel)]="notes"></textarea>
        </label>

        <fieldset>
          <legend>Entries</legend>
          <app-episode-entry-picker [patientId]="patientId" (selectionChange)="picked.set($event)"></app-episode-entry-picker>
        </fieldset>

        <div class="summary" *ngIf="start() as s">
          <p>
            <strong>Starts with</strong> {{ s.timestamp * 1000 | date: 'MMM d, h:mm a' }} — {{ s.label }}
          </p>
          <label class="inline-check">
            <input type="checkbox" name="over" [(ngModel)]="over" />
            This episode is over — it ended with the last selected entry
          </label>
          <p *ngIf="over && end() as e">
            <strong>Ends with</strong> {{ e.timestamp * 1000 | date: 'MMM d, h:mm a' }} — {{ e.label }}
          </p>
        </div>

        <p class="error" *ngIf="error()">{{ error() }}</p>

        <div class="actions">
          <button type="button" class="secondary" (click)="back()">Cancel</button>
          <button type="submit" class="primary" [disabled]="!canSave()">
            {{ saving() ? 'Saving…' : 'Create episode' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 760px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .link {
        align-self: flex-start;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      fieldset {
        border: none;
        padding: 0;
        margin: 0;
      }
      legend {
        font-weight: 700;
        margin-bottom: 0.5rem;
      }
      .summary p {
        margin: 0 0 0.5rem;
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class NewEpisodePage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = '';
  name = '';
  notes = '';
  conditionId: string | null = null;
  over = false;

  readonly conditions = signal<Condition[]>([]);
  readonly picked = signal<PickedEntry[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  private readonly ordered = computed(() => [...this.picked()].sort(byClinicalTime));
  readonly start = computed(() => this.ordered()[0] ?? null);
  readonly end = computed(() => this.ordered()[this.ordered().length - 1] ?? null);

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.get<Condition[]>(`/patients/${this.patientId}/conditions`).subscribe({
      next: (res) => this.conditions.set(res),
      error: () => this.conditions.set([]),
    });
  }

  canSave(): boolean {
    return !this.saving() && !!this.name.trim() && this.picked().length > 0;
  }

  submit() {
    if (!this.canSave()) return;
    const end = this.end();
    const body: CreateEpisodeRequest = {
      name: this.name.trim(),
      conditionId: this.conditionId,
      notes: this.notes.trim() || null,
      events: this.picked().map(({ type, id }) => ({ type, id })),
      resolvedBy: this.over && end ? { type: end.type, id: end.id } : null,
    };
    this.saving.set(true);
    this.error.set(null);
    this.api.post<Episode>(`/patients/${this.patientId}/episodes`, body).subscribe({
      next: (ep) => this.router.navigate(['/episodes', ep.id]),
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not create the episode.'));
      },
    });
  }

  back() {
    this.router.navigate(['/patients', this.patientId, 'history']);
  }
}
