import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import {
  AdverseReaction,
  CreateReactionDto,
  Medication,
  MedicationEmbodiment,
  ReactionScopeType,
  ReactionSeverity,
} from '@salud/shared/types';

/**
 * The entry point for the single most safety-critical input in the app: an adverse reaction drives
 * the `reaction_warning` banner and the `reaction_danger` full-screen interstitial at dose entry.
 * Until this page existed, the only way to record one was curl (frontend.md → Reactions).
 */
@Component({
  selector: 'app-new-reaction-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="backToPatient()">&larr; Patient</button>
      <h1>Record a reaction</h1>

      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <label class="field">
          <span>What happened</span>
          <input type="text" formControlName="description" placeholder="throat got tingly" />
        </label>

        <label class="field">
          <span>Severity</span>
          <select formControlName="severity">
            <option value="warning">Warning — note it at dose entry</option>
            <option value="danger">Danger — full-screen confirmation before every dose</option>
          </select>
        </label>

        <label class="field">
          <span>Applies to</span>
          <select formControlName="scopeType" (change)="onScopeTypeChange()">
            <option value="medication">A medication</option>
            <option value="embodiment">One specific form of a medication</option>
            <option value="tag">A whole class, by tag</option>
          </select>
        </label>

        <!-- medication / embodiment both start by choosing a medication -->
        <ng-container *ngIf="scopeType() !== 'tag'">
          <div class="field med-search" *ngIf="!selectedMedication()">
            <span>Medication</span>
            <input
              type="text"
              [value]="medicationQuery()"
              (input)="onMedicationQueryChange($event)"
              placeholder="Search by name or brand"
            />
            <ul class="med-results" *ngIf="medicationResults().length">
              <li *ngFor="let m of medicationResults()">
                <button type="button" class="med-result" (click)="selectMedication(m)">
                  {{ m.name }}
                  <span class="muted small" *ngIf="m.brandNames.length"> — {{ m.brandNames.join(', ') }}</span>
                </button>
              </li>
            </ul>
          </div>

          <div class="chosen-med" *ngIf="selectedMedication() as med">
            <span>{{ med.name }}</span>
            <button type="button" class="link" (click)="clearMedication()">Change</button>
          </div>

          <label class="field" *ngIf="scopeType() === 'embodiment' && selectedMedication()">
            <span>Which form</span>
            <select formControlName="embodimentId">
              <option value="">Choose a form…</option>
              <option *ngFor="let e of embodiments()" [value]="e.id">
                {{ e.label }}<span *ngIf="e.concentrationMgPerMl"> — {{ e.concentrationMgPerMl }} mg/mL</span>
              </option>
            </select>
          </label>
        </ng-container>

        <ng-container *ngIf="scopeType() === 'tag'">
          <label class="field">
            <span>Tag</span>
            <input type="text" formControlName="tag" list="reaction-tags" placeholder="penicillin" />
            <datalist id="reaction-tags">
              <option *ngFor="let t of knownTags()" [value]="t"></option>
            </datalist>
          </label>
          <!-- Honest rather than blocking: a tag-scoped reaction only ever matches against a
               medication's own tags, so a typo produces a reaction that silently never fires. But a
               caregiver may legitimately be recording a class before any drug in it is catalogued,
               so this must not stop the save. -->
          <p class="muted small" *ngIf="tagMatchesNothing()">
            No medication in your list carries this tag yet, so this reaction won't match anything
            until one does. That's fine if you're recording it ahead of time — just check the
            spelling.
          </p>
        </ng-container>

        <label class="field">
          <span>Date (optional — leave blank if you don't remember)</span>
          <input type="datetime-local" formControlName="occurredAt" />
        </label>

        <div class="actions">
          <button type="submit" class="primary" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Save reaction' }}
          </button>
          <button type="button" class="secondary" (click)="backToPatient()">Cancel</button>
        </div>
        <div class="error" *ngIf="error()">{{ error() }}</div>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 560px;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .link {
        align-self: flex-start;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .med-search {
        position: relative;
      }
      .med-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 10;
        list-style: none;
        margin: 0.25rem 0 0;
        padding: 0.25rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #0b1224;
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
        background: rgba(255, 255, 255, 0.08);
      }
      .chosen-med {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
      }
    `,
  ],
})
export class NewReactionPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  patientId = this.route.snapshot.paramMap.get('id')!;

  saving = signal(false);
  error = signal<string | null>(null);
  medicationQuery = signal('');
  medicationResults = signal<Medication[]>([]);
  selectedMedication = signal<Medication | null>(null);
  embodiments = signal<MedicationEmbodiment[]>([]);
  catalog = signal<Medication[]>([]);
  scopeType = signal<ReactionScopeType>('medication');

  form = this.fb.nonNullable.group({
    description: ['', Validators.required],
    severity: ['warning' as ReactionSeverity, Validators.required],
    scopeType: ['medication' as ReactionScopeType, Validators.required],
    medicationId: [''],
    embodimentId: [''],
    tag: [''],
    occurredAt: [''],
  });

  knownTags = computed(() => {
    const tags = new Set<string>();
    for (const m of this.catalog()) for (const t of m.tags) tags.add(t);
    return Array.from(tags).sort();
  });

  tagMatchesNothing = computed(() => {
    const tag = this.form.controls.tag.value.trim().toLowerCase();
    if (!tag || this.scopeType() !== 'tag') return false;
    return !this.catalog().some((m) => m.tags.some((t) => t.toLowerCase() === tag));
  });

  ngOnInit(): void {
    // One catalog fetch powers both the tag datalist and the tag-matches-nothing check. The
    // household catalog is small enough that this is cheaper than a dedicated tags endpoint.
    this.api.get<Medication[]>('/medications').subscribe({
      next: (res) => this.catalog.set(res),
      error: () => this.catalog.set([]),
    });
    this.form.controls.tag.valueChanges.subscribe(() => {
      // touch the signal graph so tagMatchesNothing recomputes
      this.catalog.set([...this.catalog()]);
    });
  }

  /**
   * Switching scope clears the other two targets, so the client can never send more than one and
   * the API's INVALID_REACTION_SCOPE stays a backstop rather than the primary UX.
   */
  onScopeTypeChange() {
    const next = this.form.controls.scopeType.value;
    this.scopeType.set(next);
    this.form.patchValue({ medicationId: '', embodimentId: '', tag: '' });
    this.selectedMedication.set(null);
    this.embodiments.set([]);
  }

  onMedicationQueryChange(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.medicationQuery.set(q);
    if (!q) {
      this.medicationResults.set([]);
      return;
    }
    this.api.get<Medication[]>('/medications', { q }).subscribe({
      next: (res) => this.medicationResults.set(res),
      error: () => this.medicationResults.set([]),
    });
  }

  selectMedication(medication: Medication) {
    this.selectedMedication.set(medication);
    this.medicationResults.set([]);
    this.medicationQuery.set('');
    this.form.patchValue({ medicationId: medication.id, embodimentId: '' });
    if (this.scopeType() === 'embodiment') {
      this.api.get<MedicationEmbodiment[]>(`/medications/${medication.id}/embodiments`).subscribe({
        next: (res) => this.embodiments.set(res),
        error: () => this.embodiments.set([]),
      });
    }
  }

  clearMedication() {
    this.selectedMedication.set(null);
    this.embodiments.set([]);
    this.form.patchValue({ medicationId: '', embodimentId: '' });
  }

  save() {
    if (this.form.invalid || this.saving()) return;
    const val = this.form.getRawValue();
    const body: CreateReactionDto = {
      description: val.description,
      severity: val.severity,
      scopeType: val.scopeType,
      // Exactly one target, chosen by scopeType. An embodiment-scoped reaction sends only
      // embodimentId — the medication was just how the caregiver found it.
      medicationId: val.scopeType === 'medication' ? val.medicationId : undefined,
      embodimentId: val.scopeType === 'embodiment' ? val.embodimentId : undefined,
      tag: val.scopeType === 'tag' ? val.tag.trim() : undefined,
      // Omitted, not null: an unknown date stores null server-side.
      occurredAt: val.occurredAt ? new Date(val.occurredAt).toISOString() : undefined,
    };

    this.error.set(null);
    this.saving.set(true);
    this.api.post<AdverseReaction, CreateReactionDto>(`/patients/${this.patientId}/reactions`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.backToPatient();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save the reaction.'));
      },
    });
  }

  backToPatient() {
    this.router.navigate(['/patients', this.patientId, 'meds']);
  }
}
