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

      <div class="error" *ngIf="loadError()">{{ loadError() }}</div>

      <ul class="analyte-list" *ngIf="analytes().length; else empty">
        <li *ngFor="let a of analytes()">
          <button type="button" class="analyte-item" (click)="goToDetail(a.id)">
            <div class="analyte-name">
              {{ a.displayName }}
              <span class="pill pill-neutral" *ngIf="a.unit">{{ a.unit }}</span>
            </div>
            <!-- Without the panel, "% Saturation" says nothing about what is saturated. -->
            <div class="muted small" *ngIf="a.panel">{{ a.panel }}</div>
            <div class="printed muted small" *ngIf="a.name !== a.displayName">as printed: {{ a.name }}</div>
          </button>
        </li>
      </ul>
      <ng-template #empty>
        <p class="muted" *ngIf="!loadError()">
          {{ query() ? 'No analytes match that search.' : 'Nothing here yet — import a lab report to fill the catalog.' }}
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
    this.api.get<Analyte[]>('/analytes', this.query() ? { q: this.query() } : undefined).subscribe({
      next: (rows) => this.analytes.set(rows),
      error: (err) => this.loadError.set(errorText(err, 'Could not load the analyte catalog.')),
    });
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
