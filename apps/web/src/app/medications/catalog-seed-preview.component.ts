import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClientService } from '../core/api-client.service';
import { apiErrorCode, errorText } from '../core/error-display';
import {
  CatalogSeedApplyRequest,
  CatalogSeedApplyResult,
  CatalogSeedDifference,
  CatalogSeedPresentItem,
  CatalogSeedPreview,
  CatalogSeedValue,
} from '@salud/shared/types';

// Plain words for the fields a present item can differ on (frontend.md → "Check repo catalog").
const FIELD_WORDS: Record<string, string> = {
  description: 'Description',
  brandNames: 'Brand names',
  tags: 'Tags',
  notes: 'Notes',
  unitType: 'Unit type',
  concentrationMgPerMl: 'Concentration (mg/mL)',
  concentrationMg: 'Concentration (mg, as printed)',
  concentrationVolumeMl: 'Concentration (mL, as printed)',
  strengthMgPerUnit: 'Strength per unit (mg)',
  mgPerKg: 'mg per kg',
  maxMgPerDose: 'Max mg per dose',
  maxMgPerDay: 'Max mg per day',
  minIntervalHours: 'Minimum hours between doses',
  ageMinMonths: 'Youngest age (months)',
  ageMaxMonths: 'Oldest age (months)',
  doseMg: 'Dose (mg)',
  doseMl: 'Dose (mL)',
  pillCount: 'Pills per dose',
  frequencyPerDay: 'Doses per day',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Check repo catalog" (frontend.md → "Medication catalog"). Previews what the repo's
 * catalog/medication-catalog.json would add to this household's list and adds only what the
 * caregiver leaves ticked. Present items are shown, never selectable: the household's edits win.
 */
@Component({
  selector: 'app-catalog-seed-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="seed-panel">
      <div class="seed-head">
        <h2>Repo catalog</h2>
        <button type="button" class="link" (click)="closed.emit()">Close</button>
      </div>

      <p class="muted" *ngIf="loading()">Checking the repo catalog…</p>

      <ng-container *ngIf="error() as message">
        <p class="error">{{ message }}</p>
        <button type="button" class="secondary" (click)="load()">Preview again</button>
      </ng-container>

      <p *ngIf="resultText() as text" class="result">{{ text }}</p>

      <ng-container *ngIf="!loading() && preview() as p">
        <p *ngIf="!offeredCount()" class="muted">Your list already has everything in the repo catalog.</p>

        <div class="group" *ngIf="p.newMedications.length">
          <h3>New medications</h3>
          <label class="inline-check item" *ngFor="let m of p.newMedications">
            <input type="checkbox" [checked]="isSelected(m.selectionId)" (change)="toggle(m.selectionId)" />
            <span>
              <strong>{{ m.name }}</strong>
              <span class="muted small" *ngIf="m.embodimentLabels.length"> — {{ m.embodimentLabels.join('; ') }}</span>
              <span class="muted small" *ngIf="m.guidelineCount">
                · {{ m.guidelineCount === 1 ? '1 dosing guideline' : m.guidelineCount + ' dosing guidelines' }}
              </span>
            </span>
          </label>
        </div>

        <div class="group" *ngIf="p.newEmbodiments.length">
          <h3>New forms</h3>
          <label class="inline-check item" *ngFor="let e of p.newEmbodiments">
            <input type="checkbox" [checked]="isSelected(e.selectionId)" (change)="toggle(e.selectionId)" />
            <span>
              <strong>{{ e.medicationName }}</strong>: {{ e.label }}
              <span class="muted small" *ngIf="e.guidelineCount">
                · {{ e.guidelineCount === 1 ? '1 dosing guideline' : e.guidelineCount + ' dosing guidelines' }}
              </span>
            </span>
          </label>
        </div>

        <div class="group" *ngIf="p.newGuidelines.length">
          <h3>New guidelines</h3>
          <label class="inline-check item" *ngFor="let g of p.newGuidelines">
            <input type="checkbox" [checked]="isSelected(g.selectionId)" (change)="toggle(g.selectionId)" />
            <span>
              <strong>{{ g.medicationName }}</strong>{{ g.embodimentLabel ? ', ' + g.embodimentLabel : '' }}:
              {{ g.type === 'weight_based' ? 'weight-based' : 'age band' }} — {{ g.source }}
            </span>
          </label>
        </div>

        <details class="group" *ngIf="p.present.length">
          <summary>Already in your list ({{ p.present.length }})</summary>
          <p class="muted small">
            Your list keeps your edits — change these on the medication itself if you want the repo's version.
          </p>
          <ul class="row-list">
            <li *ngFor="let item of p.present">
              <div>
                {{ presentLabel(item) }}
                <span class="muted small" *ngIf="!item.differences.length">· matches</span>
              </div>
              <details *ngFor="let d of item.differences" class="diff small">
                <summary>{{ fieldWords(d) }} differs</summary>
                <div><span class="muted">Your list:</span> {{ showValue(d.database) }}</div>
                <div><span class="muted">Repo:</span> {{ showValue(d.file) }}</div>
              </details>
            </li>
          </ul>
        </details>

        <button
          type="button"
          class="primary"
          *ngIf="offeredCount()"
          [disabled]="!selected().size || applying()"
          (click)="apply()"
        >
          {{ applying() ? 'Adding…' : 'Add selected (' + selected().size + ')' }}
        </button>

        <p class="muted small source">Checked {{ p.sourceUrl }} at {{ p.fetchedAt * 1000 | date: 'short' }}.</p>
      </ng-container>
    </section>
  `,
  styles: [
    `
      .seed-panel {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
      .seed-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .seed-head h2,
      .group h3 {
        margin: 0;
      }
      .group {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .item {
        align-items: flex-start;
      }
      .diff {
        margin-left: 1rem;
      }
      .source {
        overflow-wrap: anywhere;
      }
      .primary,
      .secondary {
        align-self: flex-start;
      }
    `,
  ],
})
export class CatalogSeedPreviewComponent implements OnInit {
  private readonly api = inject(ApiClientService);

  /** Fires after an apply that added something, so the list can reload. */
  @Output() applied = new EventEmitter<CatalogSeedApplyResult>();
  @Output() closed = new EventEmitter<void>();

  loading = signal(false);
  applying = signal(false);
  preview = signal<CatalogSeedPreview | null>(null);
  error = signal<string | null>(null);
  resultText = signal<string | null>(null);
  selected = signal<Set<string>>(new Set());

  offeredCount = computed(() => {
    const p = this.preview();
    return p ? p.newMedications.length + p.newEmbodiments.length + p.newGuidelines.length : 0;
  });

  ngOnInit(): void {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.post<CatalogSeedPreview, Record<string, never>>('/medications/catalog-seed/preview', {}).subscribe({
      next: (p) => {
        this.preview.set(p);
        // All ticked by default: the caregiver opened this to add what's missing.
        this.selected.set(
          new Set([...p.newMedications, ...p.newEmbodiments, ...p.newGuidelines].map((i) => i.selectionId)),
        );
        this.loading.set(false);
      },
      error: (err) => {
        this.preview.set(null);
        this.loading.set(false);
        this.error.set(errorText(err, "Couldn't check the repo catalog."));
      },
    });
  }

  isSelected(id: string) {
    return this.selected().has(id);
  }

  toggle(id: string) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  apply() {
    const p = this.preview();
    if (!p || !this.selected().size || this.applying()) return;
    this.applying.set(true);
    this.error.set(null);
    const body: CatalogSeedApplyRequest = { sourceHash: p.sourceHash, select: [...this.selected()] };
    this.api.post<CatalogSeedApplyResult, CatalogSeedApplyRequest>('/medications/catalog-seed/apply', body).subscribe({
      next: (result) => {
        this.applying.set(false);
        this.resultText.set(this.describe(result, p));
        if (result.added.length) this.applied.emit(result);
        this.load();
      },
      error: (err) => {
        this.applying.set(false);
        // On CATALOG_SEED_CHANGED the sentence already says to preview again, and the button
        // below the error does exactly that — never a silent re-apply against an unseen file.
        if (apiErrorCode(err) === 'CATALOG_SEED_CHANGED') this.preview.set(null);
        this.error.set(errorText(err, "Couldn't add from the repo catalog."));
      },
    });
  }

  /** "Added 2 medications and 1 form", naming anything someone else added meanwhile. */
  private describe(result: CatalogSeedApplyResult, p: CatalogSeedPreview): string {
    const added = new Set(result.added);
    const meds = p.newMedications.filter((m) => added.has(m.selectionId)).length;
    const forms = p.newEmbodiments.filter((e) => added.has(e.selectionId)).length;
    const guides = p.newGuidelines.filter((g) => added.has(g.selectionId)).length;
    const parts = [
      meds ? plural(meds, 'medication', 'medications') : '',
      forms ? plural(forms, 'form', 'forms') : '',
      guides ? plural(guides, 'guideline', 'guidelines') : '',
    ].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    let text = list ? `Added ${list}.` : 'Nothing was added.';
    const meanwhile = result.skipped.filter((s) => s.reason === 'already_present').length;
    if (meanwhile) text += ` ${plural(meanwhile, 'item was', 'items were')} already added by someone else.`;
    return text;
  }

  presentLabel(item: CatalogSeedPresentItem): string {
    if (item.kind === 'medication') return item.medicationName;
    if (item.kind === 'embodiment') return `${item.medicationName}: ${item.label}`;
    return `${item.medicationName}: guideline — ${item.label}`;
  }

  fieldWords(d: CatalogSeedDifference): string {
    return FIELD_WORDS[d.field] ?? d.field;
  }

  showValue(v: CatalogSeedValue): string {
    if (v === null || (Array.isArray(v) && !v.length)) return '(none)';
    return Array.isArray(v) ? v.join(', ') : String(v);
  }
}
