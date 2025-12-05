import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { ObservationType, Patient } from '@salud/shared/types';

interface EntryDraft {
  type: ObservationType;
  metadata: any;
}

@Component({
  selector: 'app-new-observation-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="card">
      <h1>New Observation</h1>
      <p class="muted">Log an observation with one or more measurement entries.</p>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label class="field">
          <span>Patient</span>
          <select formControlName="patientId" (change)="onPatientChange($event)">
            <option value="">Select a patient</option>
            <option *ngFor="let p of patients()" [value]="p.id">{{ p.fullName }}</option>
          </select>
        </label>

        <label class="field">
          <span>Observed at</span>
          <input type="datetime-local" formControlName="observedAt" />
        </label>

        <label class="field">
          <span>Notes</span>
          <textarea rows="2" formControlName="text"></textarea>
        </label>

        <div class="field">
          <span>Episodes</span>
          <div class="episode-list">
            <label class="inline-check" *ngFor="let ep of activeEpisodes()">
              <input type="checkbox" [value]="ep.id" (change)="toggleEpisode(ep.id, $event)" />
              <span>{{ ep.name }}</span>
            </label>
            <label class="inline-check">
              <input type="checkbox" [checked]="createNewEpisode()" (change)="toggleCreateNew($event)" />
              <span>Create new episode</span>
            </label>
          </div>
          <label class="field" *ngIf="createNewEpisode()">
            <span>New episode name</span>
            <input type="text" formControlName="startEpisodeName" placeholder="e.g. Fever" />
          </label>
        </div>

        <label class="field inline-check">
          <input type="checkbox" formControlName="resolveSelected" />
          <span>Resolve selected episodes</span>
        </label>

        <label class="field">
          <span>Symptom tags (comma separated)</span>
          <input type="text" formControlName="symptomTags" placeholder="cough, rash" />
        </label>

        <div class="entry-builder">
          <h3>Add entry</h3>
          <label class="field">
            <span>Type</span>
            <select [(ngModel)]="entryType" name="entryType" [ngModelOptions]="{ standalone: true }">
              <option *ngFor="let t of types" [value]="t">{{ t }}</option>
            </select>
          </label>
          <label class="field">
            <span>Metadata (JSON)</span>
            <textarea
              rows="3"
              [(ngModel)]="entryMetadata"
              name="entryMetadata"
              [ngModelOptions]="{ standalone: true }"
              placeholder='{"bpm":120}'
            ></textarea>
          </label>
          <button type="button" class="secondary" (click)="addEntry()">Add entry</button>
          <div class="muted small">At least one entry is required.</div>
          <ul class="entries">
            <li *ngFor="let e of entries(); let i = index">
              <span class="pill">{{ e.type }}</span>
              <code>{{ e.metadata | json }}</code>
              <button type="button" class="icon-button" (click)="removeEntry(i)">✕</button>
            </li>
          </ul>
        </div>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || entries().length === 0 || saving()">
            {{ saving() ? 'Saving…' : 'Save observation' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
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
      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      input,
      select,
      textarea {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      textarea {
        resize: vertical;
      }
      .entry-builder {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .entries {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .entries li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .pill {
        display: inline-flex;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: rgba(34, 211, 238, 0.15);
        border: 1px solid rgba(34, 211, 238, 0.35);
        color: #7dd3fc;
        font-weight: 700;
        text-transform: capitalize;
      }
      code {
        background: rgba(255, 255, 255, 0.05);
        padding: 0.15rem 0.35rem;
        border-radius: 6px;
        font-size: 0.85rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-top: 0.5rem;
      }
      .primary,
      .secondary {
        padding: 0.65rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        border: none;
        cursor: pointer;
      }
      .primary {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #e2e8f0;
      }
      .icon-button {
        border: none;
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
      }
      .error {
        color: #fca5a5;
      }
      .small {
        font-size: 0.9rem;
      }
    `,
  ],
})
export class NewObservationPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<Array<{ id: string; name: string }>>([]);
  createNewEpisode = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  entries = signal<EntryDraft[]>([]);

  types: ObservationType[] = [
    'temperature',
    'heart_rate',
    'respiratory_rate',
    'oxygen_saturation',
    'pain_score',
    'weight',
    'height',
    'lesion_size',
    'symptom',
    'note',
    'photo',
  ];

  entryType: ObservationType = 'note';
  entryMetadata = '';

  form = this.fb.nonNullable.group({
    patientId: ['', [Validators.required]],
    observedAt: ['', [Validators.required]],
    text: [''],
    episodeSelection: this.fb.control<string[]>([], { nonNullable: true }),
    resolveSelected: [false],
    startEpisodeName: [''],
    symptomTags: [''],
  });

  ngOnInit(): void {
    // Prefill observedAt with current datetime-local value
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    this.form.patchValue({ observedAt: localIso });

    const user = this.auth.user();
    if (!user && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.loadPatients(),
        error: () => this.auth.logout(),
      });
    } else {
      this.loadPatients();
    }
  }

  onPatientChange(event: Event) {
    const pid = (event.target as HTMLSelectElement).value;
    if (pid) {
      this.form.patchValue({ patientId: pid });
      this.loadEpisodes(pid);
    }
  }

  private loadPatients() {
    const user = this.auth.user();
    if (!user) return;
    this.api.get<Patient[]>(`/users/${user.id}/patients`).subscribe({
      next: (res) => {
        this.patients.set(res);
        const current = this.form.getRawValue().patientId;
        const pid = current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          this.loadEpisodes(pid);
        }
      },
      error: () => this.error.set('Unable to load patients'),
    });
  }

  private loadEpisodes(patientId: string) {
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => this.activeEpisodes.set(eps),
      error: () => this.activeEpisodes.set([]),
    });
  }

  addEntry() {
    try {
      const parsed = this.entryMetadata ? JSON.parse(this.entryMetadata) : null;
      this.entries.set([...this.entries(), { type: this.entryType, metadata: parsed }]);
      this.entryMetadata = '';
    } catch (e) {
      this.error.set('Metadata must be valid JSON');
    }
  }

  removeEntry(idx: number) {
    const next = [...this.entries()];
    next.splice(idx, 1);
    this.entries.set(next);
  }

  toggleEpisode(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const current = new Set(this.form.getRawValue().episodeSelection);
    if (checked) {
      current.add(id);
    } else {
      current.delete(id);
    }
    this.form.patchValue({ episodeSelection: Array.from(current) });
  }

  toggleCreateNew(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.createNewEpisode.set(checked);
    if (checked) {
      const current = new Set(this.form.getRawValue().episodeSelection);
      current.add('__new__');
      this.form.patchValue({ episodeSelection: Array.from(current) });
    } else {
      const current = new Set(this.form.getRawValue().episodeSelection);
      current.delete('__new__');
      this.form.patchValue({ episodeSelection: Array.from(current), startEpisodeName: '' });
    }
  }

  submit() {
    if (this.form.invalid || this.entries().length === 0) return;
    const user = this.auth.user();
    if (!user) {
      this.error.set('You must be signed in.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const { patientId, observedAt, text, symptomTags, startEpisodeName, episodeSelection, resolveSelected } =
      this.form.getRawValue();
    const episodeIds = (episodeSelection || []).filter((id) => id !== '__new__');
    const payload: any = {
      observedAt: new Date(observedAt).toISOString(),
      text: text ?? undefined,
      symptomTags: symptomTags ? symptomTags.split(',').map((s) => s.trim()).filter(Boolean) : [],
      startEpisodeName: this.createNewEpisode() ? startEpisodeName || undefined : undefined,
      episodeIds: episodeIds.length ? episodeIds : undefined,
      resolvesEpisodeIds: resolveSelected && episodeIds.length ? episodeIds : undefined,
      entries: this.entries(),
    };
    this.api.post(`/patients/${patientId}/observations`, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not save observation.');
      },
    });
  }

  cancel() {
    this.router.navigateByUrl('/dashboard');
  }
}
