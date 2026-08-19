import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { Analyte } from '@salud/shared/types';

@Component({
  selector: 'app-analytes-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <h1>Analyte Catalog</h1>
      <p class="muted">
        Lab analytes and the standards to read them against. The catalog fills itself as you import
        reports — reference ranges live here, not on the results themselves.
      </p>

      <input
        type="search"
        class="search"
        placeholder="Search analytes…"
        [value]="query()"
        (input)="onQueryChange($event)"
      />

      <!-- Vitals live in this same catalog, because a vital sign is a measured thing read against a
           named range — exactly what an analyte is. A household with a big lab catalog would
           otherwise have to hunt for the row that drives its fever charts. -->
      <div class="kind-filter">
        <button type="button" class="pill" [class.pill-success]="kind() === 'lab'" (click)="setKind('lab')">
          Lab analytes
        </button>
        <button type="button" class="pill" [class.pill-success]="kind() === 'vital'" (click)="setKind('vital')">
          Vital signs
        </button>
        <button type="button" class="pill" [class.pill-success]="kind() === 'all'" (click)="setKind('all')">
          All
        </button>
      </div>

      <div class="error" *ngIf="loadError()">{{ loadError() }}</div>

      <ul class="analyte-list" *ngIf="analytes().length; else empty">
        <li *ngFor="let a of analytes()">
          <button type="button" class="analyte-item" (click)="goToDetail(a.id)">
            <div class="analyte-name">
              {{ a.displayName }}
              <span class="pill pill-neutral" *ngIf="a.unit">{{ a.unit }}</span>
              <span class="pill" *ngIf="a.vitalMetric">vital</span>
            </div>
            <!-- Without the panel, "% Saturation" says nothing about what is saturated. -->
            <div class="muted small" *ngIf="a.panel">{{ a.panel }}</div>
            <div class="printed muted small" *ngIf="a.name !== a.displayName">as printed: {{ a.name }}</div>
          </button>
        </li>
      </ul>
      <ng-template #empty>
        <p class="muted" *ngIf="!loadError()">
          {{ emptyMessage() }}
        </p>
      </ng-template>

      <div class="new-analyte">
        <button type="button" class="secondary" (click)="toggleNewForm()">
          {{ showNewForm() ? 'Cancel' : '+ Add analyte' }}
        </button>
        <form *ngIf="showNewForm()" [formGroup]="newForm" (ngSubmit)="createAnalyte()">
          <label class="field">
            <span>Name as the lab prints it</span>
            <input type="text" formControlName="name" placeholder="FERRITIN" />
          </label>
          <label class="field">
            <span>Display name (optional)</span>
            <input type="text" formControlName="displayName" placeholder="defaults to title case" />
          </label>
          <label class="field">
            <span>Unit (optional)</span>
            <input type="text" formControlName="unit" placeholder="ng/mL" />
          </label>
          <label class="field">
            <span>Panel (optional)</span>
            <input type="text" formControlName="panel" placeholder="IRON AND TOTAL IRON BINDING CAPACITY" />
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
      }
      .analyte-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .analyte-item {
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
      .analyte-item:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .analyte-name {
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .kind-filter {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin: 0.6rem 0;
      }
      .kind-filter .pill {
        cursor: pointer;
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 0.8rem;
      }
      .new-analyte {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
      .new-analyte form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
    `,
  ],
})
export class AnalytesPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  analytes = signal<Analyte[]>([]);
  query = signal('');
  kind = signal<'lab' | 'vital' | 'all'>('lab');
  showNewForm = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  loadError = signal<string | null>(null);

  newForm = this.fb.group({
    name: ['', Validators.required],
    displayName: [''],
    unit: [''],
    panel: [''],
  });

  ngOnInit() {
    this.load();
  }

  private load() {
    this.loadError.set(null);
    const params: Record<string, string> = { kind: this.kind() };
    if (this.query()) params['q'] = this.query();
    this.api.get<Analyte[]>('/analytes', params).subscribe({
      next: (rows) => this.analytes.set(rows),
      error: (err) => this.loadError.set(errorText(err, 'Could not load the analyte catalog.')),
    });
  }

  setKind(kind: 'lab' | 'vital' | 'all') {
    this.kind.set(kind);
    this.load();
  }

  /**
   * The lab catalog is empty until the first import, which is normal and worth saying. The vitals
   * list is never empty — if it looks empty, something is wrong rather than merely unstarted.
   */
  emptyMessage(): string {
    if (this.query()) return 'No analytes match that search.';
    if (this.kind() === 'vital') return 'Vital signs are missing from the catalog — this is unexpected.';
    return 'Nothing here yet — import a lab report to fill the catalog.';
  }

  onQueryChange(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.load();
  }

  toggleNewForm() {
    this.showNewForm.set(!this.showNewForm());
    this.error.set(null);
  }

  goToDetail(id: string) {
    this.router.navigate(['/analytes', id]);
  }

  createAnalyte() {
    if (this.newForm.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    const val = this.newForm.value;
    this.api
      .post<Analyte>('/analytes', {
        name: val.name,
        displayName: val.displayName?.trim() || undefined,
        unit: val.unit?.trim() || undefined,
        panel: val.panel?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showNewForm.set(false);
          this.newForm.reset({ name: '', displayName: '', unit: '', panel: '' });
          this.load();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(errorText(err, 'Could not create the analyte.'));
        },
      });
  }
}
