import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClientService } from './api-client.service';
import { Revision, RevisionEntityType } from '@salud/shared/types';

// "Edited" marker + expandable history for a correctable entity (F-1.4). The original state is
// never overwritten — each PATCH captures a Revision first; this component just reads them back.
@Component({
  selector: 'app-revision-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="revision-history" *ngIf="revisions().length">
      <button type="button" class="marker" (click)="expanded.set(!expanded())">
        edited {{ revisions().length }} time{{ revisions().length === 1 ? '' : 's' }} — last
        {{ revisions()[0].editedAt * 1000 | date: 'medium' }}
        <span class="chevron">{{ expanded() ? '▲' : '▼' }}</span>
      </button>
      <ul class="list" *ngIf="expanded()">
        <li *ngFor="let r of revisions()">
          <div class="muted small">{{ r.editedAt * 1000 | date: 'medium' }} — edited by {{ r.editedByUserId }}</div>
          <pre>{{ r.snapshot | json }}</pre>
        </li>
      </ul>
    </div>
  `,
  styles: [
    `
      .revision-history {
        margin-top: 0.5rem;
      }
      .marker {
        background: none;
        border: none;
        color: #7dd3fc;
        cursor: pointer;
        padding: 0;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .chevron {
        font-size: 0.7rem;
      }
      .list {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .list li {
        padding: 0.5rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
      }
      .muted {
        color: #94a3b8;
      }
      .small {
        font-size: 0.8rem;
      }
      pre {
        margin: 0.3rem 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.78rem;
        color: #cbd5e1;
      }
    `,
  ],
})
export class RevisionHistoryComponent implements OnChanges {
  private readonly api = inject(ApiClientService);

  @Input({ required: true }) entityType!: RevisionEntityType;
  @Input({ required: true }) entityId!: string;

  revisions = signal<Revision[]>([]);
  expanded = signal(false);

  ngOnChanges(): void {
    if (!this.entityType || !this.entityId) return;
    this.api.get<Revision[]>(`/${this.entityType}s/${this.entityId}/revisions`).subscribe({
      next: (res) => this.revisions.set(Array.isArray(res) ? res : []),
      error: () => this.revisions.set([]),
    });
  }
}
