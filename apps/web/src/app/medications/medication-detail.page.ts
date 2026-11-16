import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { Medication, MedicationEmbodiment, MedicationGuideline } from '@salud/shared/types';
import { errorText } from '../core/error-display';
import { concentrationText } from '../core/concentration-display';
import { MedicationHeaderEditorComponent } from './medication-header-editor.component';
import { EmbodimentEditorComponent } from './embodiment-editor.component';
import { GuidelineEditorComponent } from './guideline-editor.component';

@Component({
  selector: 'app-medication-detail-page',
  standalone: true,
  imports: [CommonModule, MedicationHeaderEditorComponent, EmbodimentEditorComponent, GuidelineEditorComponent],
  template: `
    <!-- Outside the *ngIf below, deliberately: a load failure leaves medication() null, and
         rendering nothing at all is the exact defect frontend.md names ("an unreachable API must
         say so"). Three states -- loading, failed, loaded -- must be distinguishable. -->
    <div class="card" *ngIf="!medication()">
      <button type="button" class="link" (click)="backToList()">&larr; Medications</button>
      <div class="error" *ngIf="loadError()">{{ loadError() }}</div>
      <p class="muted" *ngIf="!loadError()">Loading…</p>
    </div>

    <div class="card" *ngIf="medication() as med">
      <button type="button" class="link" (click)="backToList()">&larr; Medications</button>

      <!-- Every Edit control below is gated on nothing but the medication having loaded. Two
           controls hidden behind a condition that held in the common case have shipped broken
           before; a catalog row that cannot be corrected is the defect this whole editor fixes. -->
      <ng-container *ngIf="!editingHeader(); else headerEditor">
        <div class="title-row">
          <h1>{{ med.name }}</h1>
          <button type="button" class="secondary edit" (click)="editingHeader.set(true)">Edit</button>
        </div>
        <span class="pill pill-neutral inactive-pill" *ngIf="!med.defaultActive">
          Inactive — not offered when logging doses
        </span>
        <p class="muted" *ngIf="med.brandNames.length">Also known as: {{ med.brandNames.join(', ') }}</p>
        <p class="muted" *ngIf="med.description">{{ med.description }}</p>
        <div class="med-tags" *ngIf="med.tags.length">
          <span class="pill" *ngFor="let t of med.tags">{{ t }}</span>
        </div>
      </ng-container>
      <ng-template #headerEditor>
        <h1>Edit {{ med.name }}</h1>
        <app-medication-header-editor
          [medication]="med"
          (saved)="onHeaderSaved()"
          (deleted)="backToList()"
          (cancelled)="editingHeader.set(false)"
        />
      </ng-template>

      <section>
        <h2>Embodiments</h2>
        <div class="error" *ngIf="embodimentsError()">{{ embodimentsError() }}</div>
        <div class="error" *ngIf="cabinetError()">{{ cabinetError() }}</div>
        <ul class="emb-list">
          <li *ngFor="let e of embodiments(); trackBy: trackById">
            <app-embodiment-editor
              *ngIf="editingEmbodimentId() === e.id; else embodimentRow"
              [medicationId]="medicationId"
              [embodiment]="e"
              (saved)="onCatalogChanged()"
              (deleted)="onCatalogChanged()"
              (cancelled)="editingEmbodimentId.set(null)"
            />
            <ng-template #embodimentRow>
              <div class="row-head">
                <div class="emb-header">
                  <strong>{{ e.label }}</strong>
                  <span class="pill">{{ e.unitType }}</span>
                </div>
                <button type="button" class="secondary edit" (click)="editEmbodiment(e.id)">Edit</button>
              </div>
              <div class="emb-details muted">
                <span *ngIf="concentrationText(e) as conc">{{ conc }}</span>
                <span *ngIf="e.strengthMgPerUnit">{{ e.strengthMgPerUnit }} mg/unit</span>
              </div>
              <p class="muted small emb-notes" *ngIf="e.notes">{{ e.notes }}</p>
              <div class="cabinet-row">
                <label class="inline-check">
                  <input type="checkbox" [checked]="e.atHome" (change)="toggleAtHome(e, $event)" />
                  <span>At home</span>
                </label>
                <label class="inline-check">
                  <input type="checkbox" [checked]="e.runningLow" (change)="toggleRunningLow(e, $event)" />
                  <span>Running low</span>
                </label>
                <span class="muted small" *ngIf="e.expiresAt">
                  Expires {{ e.expiresAt * 1000 | date: 'mediumDate' }}
                </span>
              </div>
            </ng-template>
          </li>
        </ul>
        <button type="button" class="secondary" *ngIf="!addingEmbodiment()" (click)="addEmbodiment()">
          + Add embodiment
        </button>
        <app-embodiment-editor
          *ngIf="addingEmbodiment()"
          [medicationId]="medicationId"
          (saved)="onCatalogChanged()"
          (cancelled)="addingEmbodiment.set(false)"
        />
      </section>

      <section>
        <h2>Guidelines</h2>
        <div class="error" *ngIf="guidelinesError()">{{ guidelinesError() }}</div>
        <ul class="guideline-list">
          <li *ngFor="let g of guidelines(); trackBy: trackById">
            <app-guideline-editor
              *ngIf="editingGuidelineId() === g.id; else guidelineRow"
              [medicationId]="medicationId"
              [guideline]="g"
              (saved)="onCatalogChanged()"
              (deleted)="onCatalogChanged()"
              (cancelled)="editingGuidelineId.set(null)"
            />
            <ng-template #guidelineRow>
              <div class="row-head">
                <div class="guideline-header">
                  <span class="pill">{{ g.type === 'weight_based' ? 'Weight-based' : 'Age-band' }}</span>
                  <span class="muted small">{{ g.source }}</span>
                </div>
                <button type="button" class="secondary edit" (click)="editGuideline(g.id)">Edit</button>
              </div>
              <div class="guideline-details muted" *ngIf="g.type === 'weight_based'">
                {{ g.mgPerKg }} mg/kg — max {{ g.maxMgPerDose }} mg/dose, {{ g.maxMgPerDay }} mg/day, every
                {{ g.minIntervalHours }}h
              </div>
              <div class="guideline-details muted" *ngIf="g.type === 'age_band'">
                {{ g.ageMinMonths }}–{{ g.ageMaxMonths }} mo — {{ g.doseMg }} mg ({{ g.doseMl }} mL),
                {{ g.frequencyPerDay }}x/day, max {{ g.maxMgPerDay }} mg/day
              </div>
            </ng-template>
          </li>
        </ul>
        <button type="button" class="secondary" *ngIf="!addingGuideline()" (click)="addGuideline()">
          + Add guideline
        </button>
        <app-guideline-editor
          *ngIf="addingGuideline()"
          [medicationId]="medicationId"
          (saved)="onCatalogChanged()"
          (cancelled)="addingGuideline.set(false)"
        />
      </section>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      h2 {
        font-size: 1.1rem;
      }
      .link {
        align-self: flex-start;
      }
      .title-row,
      .row-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .title-row h1 {
        overflow-wrap: anywhere;
      }
      /* Always on screen, right of what it edits, at full thumb height. */
      .edit {
        flex: none;
      }
      .inactive-pill {
        align-self: flex-start;
      }
      .med-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      section {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .emb-list,
      .guideline-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .emb-list li,
      .guideline-list li {
        padding: 0.6rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .emb-header,
      .guideline-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        min-height: 2.75rem;
      }
      .emb-details,
      .guideline-details {
        margin-top: 0.25rem;
        font-size: 0.9rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .emb-notes {
        margin: 0.25rem 0 0;
      }
      .cabinet-row {
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      section > .secondary {
        align-self: flex-start;
      }
    `,
  ],
})
export class MedicationDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  medicationId = this.route.snapshot.paramMap.get('id')!;

  medication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);
  guidelines = signal<MedicationGuideline[]>([]);

  // One editor open per list at a time: opening another row's editor (or the add form) closes the
  // one before, so there is never a half-edited form out of sight further up the page.
  editingHeader = signal(false);
  editingEmbodimentId = signal<string | null>(null);
  addingEmbodiment = signal(false);
  editingGuidelineId = signal<string | null>(null);
  addingGuideline = signal(false);

  loadError = signal<string | null>(null);
  embodimentsError = signal<string | null>(null);
  guidelinesError = signal<string | null>(null);
  cabinetError = signal<string | null>(null);

  concentrationText = concentrationText;

  // By id, so a reload while a row is being edited keeps that row's editor -- and what was typed in it.
  trackById = (_: number, row: { id: string }) => row.id;

  ngOnInit(): void {
    this.load();
  }

  private load() {
    this.loadError.set(null);
    this.api.get<Medication>(`/medications/${this.medicationId}`).subscribe({
      next: (m) => this.medication.set(m),
      error: (err) => this.loadError.set(errorText(err, 'Unable to load this medication.')),
    });
    // Their own signals rather than loadError: a failed guidelines fetch should still leave the
    // header and the rest of the page readable, and say so in its own section.
    this.embodimentsError.set(null);
    this.api.get<MedicationEmbodiment[]>(`/medications/${this.medicationId}/embodiments`).subscribe({
      next: (e) => this.embodiments.set(e),
      error: (err) => this.embodimentsError.set(errorText(err, 'Could not load the forms of this medication.')),
    });
    this.guidelinesError.set(null);
    this.api.get<MedicationGuideline[]>(`/medications/${this.medicationId}/guidelines`).subscribe({
      next: (g) => this.guidelines.set(g),
      error: (err) => this.guidelinesError.set(errorText(err, 'Could not load the dosing guidelines.')),
    });
  }

  backToList() {
    this.router.navigate(['/medications']);
  }

  editEmbodiment(id: string) {
    this.addingEmbodiment.set(false);
    this.editingEmbodimentId.set(id);
  }

  addEmbodiment() {
    this.editingEmbodimentId.set(null);
    this.addingEmbodiment.set(true);
  }

  editGuideline(id: string) {
    this.addingGuideline.set(false);
    this.editingGuidelineId.set(id);
  }

  addGuideline() {
    this.editingGuidelineId.set(null);
    this.addingGuideline.set(true);
  }

  onHeaderSaved() {
    this.editingHeader.set(false);
    this.load();
  }

  /** After any embodiment or guideline save or delete: close the editors and re-read the page. */
  onCatalogChanged() {
    this.editingEmbodimentId.set(null);
    this.addingEmbodiment.set(false);
    this.editingGuidelineId.set(null);
    this.addingGuideline.set(false);
    this.load();
  }

  toggleAtHome(embodiment: MedicationEmbodiment, event: Event) {
    this.patchCabinet(embodiment, { atHome: (event.target as HTMLInputElement).checked });
  }

  toggleRunningLow(embodiment: MedicationEmbodiment, event: Event) {
    this.patchCabinet(embodiment, { runningLow: (event.target as HTMLInputElement).checked });
  }

  /**
   * Optimistic, with a real rollback. A failed PATCH used to leave the checkbox visually checked
   * while the server said otherwise — on `runningLow` that means the shopping list silently
   * disagrees with the screen.
   *
   * The rollback replaces the whole array rather than mutating a row: the DOM `checked` property
   * has already been changed by the user's click, and Angular won't rewrite a binding whose value
   * it believes is unchanged.
   */
  private patchCabinet(embodiment: MedicationEmbodiment, changes: Partial<MedicationEmbodiment>) {
    const previous = this.embodiments();
    this.cabinetError.set(null);
    this.embodiments.set(previous.map((e) => (e.id === embodiment.id ? { ...e, ...changes } : e)));

    this.api.patch<MedicationEmbodiment, any>(`/embodiments/${embodiment.id}`, changes).subscribe({
      // Replace the row from the response rather than re-running load(): three requests to confirm
      // one boolean is wasteful and visibly flickers.
      next: (updated) =>
        this.embodiments.set(this.embodiments().map((e) => (e.id === updated.id ? updated : e))),
      error: (err) => {
        this.embodiments.set([...previous]);
        this.cabinetError.set(errorText(err, 'Could not update the cabinet status.'));
      },
    });
  }
}
