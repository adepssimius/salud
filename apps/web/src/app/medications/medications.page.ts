import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { Medication } from '@salud/shared/types';

@Component({
  selector: 'app-medications-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <h1>Medication Catalog</h1>
      <p class="muted">
        Search by generic or brand name — the box in your hand says "Tylenol", not "acetaminophen".
      </p>

      <input
        type="search"
        class="search"
        placeholder="Search medications…"
        [value]="query()"
        (input)="onQueryChange($event)"
      />

      <ul class="med-list" *ngIf="medications().length; else empty">
        <li *ngFor="let m of medications()">
          <button type="button" class="med-item" (click)="goToDetail(m.id)">
            <div class="med-name">
              {{ m.name }}
              <span class="pill" *ngIf="!m.defaultActive">inactive</span>
            </div>
            <div class="med-brands muted" *ngIf="m.brandNames.length">{{ m.brandNames.join(', ') }}</div>
            <div class="med-tags" *ngIf="m.tags.length">
              <span class="pill" *ngFor="let t of m.tags">{{ t }}</span>
            </div>
          </button>
        </li>
      </ul>
      <ng-template #empty>
        <p class="muted">No medications match yet.</p>
      </ng-template>

      <div class="new-med">
        <button type="button" class="secondary" (click)="toggleNewForm()">
          {{ showNewForm() ? 'Cancel' : '+ Add medication' }}
        </button>
        <form *ngIf="showNewForm()" [formGroup]="newForm" (ngSubmit)="createMedication()">
          <label class="field">
            <span>Name (generic)</span>
            <input type="text" formControlName="name" placeholder="acetaminophen" />
          </label>
          <label class="field">
            <span>Brand names (comma separated)</span>
            <input type="text" formControlName="brandNames" placeholder="Tylenol, Panadol" />
          </label>
          <label class="field">
            <span>Tags (comma separated)</span>
            <input type="text" formControlName="tags" placeholder="antipyretic, analgesic" />
          </label>
          <button type="submit" class="primary" [disabled]="newForm.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Create' }}
          </button>
          <div class="error" *ngIf="error()">{{ error() }}</div>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .muted {
        color: #cbd5e1;
      }
      .search {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .med-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .med-item {
        width: 100%;
        text-align: left;
        padding: 0.6rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .med-item:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .med-name {
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .med-brands {
        font-size: 0.9rem;
      }
      .med-tags {
        display: flex;
        gap: 0.35rem;
        margin-top: 0.35rem;
      }
      .pill {
        display: inline-flex;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(34, 211, 238, 0.15);
        border: 1px solid rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
        font-size: 0.75rem;
        font-weight: 700;
      }
      .new-med {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
      .new-med form {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        margin-top: 0.6rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      input {
        padding: 0.6rem 0.7rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .primary,
      .secondary {
        padding: 0.6rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        align-self: flex-start;
      }
      .primary {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #e2e8f0;
      }
      .error {
        color: #fca5a5;
      }
    `,
  ],
})
export class MedicationsPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  medications = signal<Medication[]>([]);
  query = signal('');
  showNewForm = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);

  newForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    brandNames: [''],
    tags: [''],
  });

  ngOnInit(): void {
    this.load();
  }

  private load() {
    this.api
      .get<Medication[]>('/medications', this.query() ? { q: this.query() } : undefined)
      .subscribe({
        next: (res) => this.medications.set(res),
        error: () => this.medications.set([]),
      });
  }

  onQueryChange(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.load();
  }

  goToDetail(id: string) {
    this.router.navigate(['/medications', id]);
  }

  toggleNewForm() {
    this.showNewForm.set(!this.showNewForm());
    this.error.set(null);
  }

  createMedication() {
    if (this.newForm.invalid || this.saving()) return;
    const val = this.newForm.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .post<Medication, any>('/medications', {
        name: val.name,
        brandNames: val.brandNames ? val.brandNames.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        tags: val.tags ? val.tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showNewForm.set(false);
          this.newForm.reset({ name: '', brandNames: '', tags: '' });
          this.load();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(errorText(err, 'Could not add the medication.'));
        },
      });
  }
}
