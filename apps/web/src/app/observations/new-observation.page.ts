import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { EntryDraft, EntryMetadataFormComponent } from './entry-metadata-form.component';
import { entrySummary, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { Advisory, Observation, ObservationType, Patient, TimelineResponse, UnitPreference } from '@salud/shared/types';

@Component({
  selector: 'app-new-observation-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PhotoThumbnailComponent, EntryMetadataFormComponent],
  template: `
    <div class="card" *ngIf="firedAdvisories().length; else formCard">
      <h1>Observation saved</h1>
      <div class="protocol-card" *ngFor="let a of firedAdvisories()">
        <div class="protocol-header">
          <span class="icon">⛔</span>
          <span class="name">{{ a.payload?.['protocolName'] }}</span>
        </div>
        <p class="instruction">{{ a.payload?.['instructionText'] }}</p>
        <p class="muted small">
          {{ a.payload?.['triggerMetric'] }}
          {{ a.payload?.['observedValue'] }}
          {{ a.payload?.['triggerOperator'] === 'gte' ? '≥' : '≤' }}
          {{ a.payload?.['triggerValue'] }}
          — {{ a.payload?.['conditionName'] }}
        </p>
        <p class="muted small">Source: {{ a.payload?.['sourceText'] }}</p>
      </div>
      <div class="actions">
        <button type="button" class="primary" (click)="continueToDashboard()">Continue to dashboard</button>
      </div>
    </div>

    <ng-template #formCard>
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
              <input type="checkbox" [value]="ep.id" [checked]="isEpisodeSelected(ep.id)" (change)="toggleEpisode(ep.id, $event)" />
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

        <app-entry-metadata-form
          [patientId]="form.getRawValue().patientId"
          [framingHintFileId]="framingHintFileId()"
          (typeChange)="onEntryTypeChange($event)"
          (entryAdded)="addEntry($event)"
        ></app-entry-metadata-form>

        <ul class="entries">
          <li *ngFor="let e of entries(); let i = index">
            <span class="pill">{{ e.type }}</span>
            <app-photo-thumbnail *ngIf="e.type === 'photo'; else entryText" [fileId]="e.metadata?.fileId"></app-photo-thumbnail>
            <ng-template #entryText><span class="summary">{{ entrySummary(e) }}</span></ng-template>
            <button type="button" class="icon-button" (click)="removeEntry(i)">✕</button>
          </li>
        </ul>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || entries().length === 0 || saving()">
            {{ saving() ? 'Saving…' : 'Save observation' }}
          </button>
        </div>
      </form>
    </div>
    </ng-template>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .episode-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
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
        text-transform: capitalize;
      }
      .summary {
        font-size: 0.9rem;
        color: #e2e8f0;
      }
      .icon-button {
        border: none;
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
      }
      .protocol-card {
        border: 1px solid rgba(248, 113, 113, 0.4);
        background: rgba(248, 113, 113, 0.08);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        margin-bottom: 0.75rem;
      }
      .protocol-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .protocol-header .name {
        font-weight: 700;
        color: #fecdd3;
      }
      .instruction {
        font-weight: 700;
        margin: 0.4rem 0;
      }
    `,
  ],
})
export class NewObservationPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<Array<{ id: string; name: string }>>([]);
  createNewEpisode = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  entries = signal<EntryDraft[]>([]);
  firedAdvisories = signal<Advisory[]>([]);

  // Mirrors the child form's current type so episode changes only refetch the framing hint when a
  // photo is actually being composed.
  entryType: ObservationType = 'temperature';
  framingHintFileId = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    patientId: ['', [Validators.required]],
    observedAt: ['', [Validators.required]],
    text: [''],
    episodeSelection: this.fb.control<string[]>([], { nonNullable: true }),
    resolveSelected: [false],
    startEpisodeName: [''],
  });

  // Set when arriving from an episode's "Resolve this episode" action
  // (episode-detail.page.ts) — resolution is deliberately only ever a side effect of a logged
  // observation, never a direct edit, so that page hands off here instead of calling an API itself.
  private resolveEpisodeIdParam: string | null = null;

  ngOnInit(): void {
    // Prefill observedAt with current datetime-local value
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    this.form.patchValue({ observedAt: localIso });

    const patientIdParam = this.route.snapshot.queryParamMap.get('patientId');
    if (patientIdParam) this.form.patchValue({ patientId: patientIdParam });
    this.resolveEpisodeIdParam = this.route.snapshot.queryParamMap.get('resolveEpisodeId');

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
    this.api.get<Patient[]>(`/patients`).subscribe({
      next: (res) => {
        this.patients.set(res);
        const current = this.form.getRawValue().patientId;
        const pid = current || (res.length ? res[0].id : '');
        if (pid) {
          this.form.patchValue({ patientId: pid });
          this.loadEpisodes(pid);
        }
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load patients')),
    });
  }

  private loadEpisodes(patientId: string) {
    this.api.get<Array<{ id: string; name: string }>>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => {
        this.activeEpisodes.set(eps);
        if (this.resolveEpisodeIdParam && eps.some((ep) => ep.id === this.resolveEpisodeIdParam)) {
          this.form.patchValue({
            episodeSelection: [this.resolveEpisodeIdParam],
            resolveSelected: true,
          });
          this.resolveEpisodeIdParam = null; // only ever apply this once, on the first successful load
        }
      },
      error: () => this.activeEpisodes.set([]),
    });
  }

  addEntry(draft: EntryDraft) {
    this.error.set(null);
    this.entries.set([...this.entries(), draft]);
  }

  onEntryTypeChange(type: ObservationType) {
    this.entryType = type;
    this.error.set(null);
    if (type === 'photo') {
      this.refreshFramingHint();
    }
  }

  // One-line human summary for the pending-entries list, so a caregiver reviewing what they're
  // about to save reads values rather than field names. Shown in their own units — the entries were
  // just converted to canonical on the way in, so this converts back for display.
  entrySummary(entry: EntryDraft): string {
    return entrySummary(entry, unitsFor(this.auth.user()));
  }

  private refreshFramingHint() {
    const { patientId, episodeSelection } = this.form.getRawValue();
    const episodeId = (episodeSelection || []).find((id) => id !== '__new__');
    if (!patientId || !episodeId) {
      this.framingHintFileId.set(null);
      return;
    }
    this.api.get<TimelineResponse>(`/patients/${patientId}/timeline`, { episodeId }).subscribe({
      next: (res) => {
        const photoEntries = res.entries
          .filter((e) => e.kind === 'observation')
          .flatMap((e) =>
            ((e.display as any).entries ?? [])
              .filter((x: any) => x.type === 'photo' && x.metadata?.fileId)
              .map((x: any) => ({ timestamp: e.timestamp, fileId: x.metadata.fileId as string })),
          )
          .sort((a, b) => b.timestamp - a.timestamp);
        this.framingHintFileId.set(photoEntries.length ? photoEntries[0].fileId : null);
      },
      error: () => this.framingHintFileId.set(null),
    });
  }

  removeEntry(idx: number) {
    const next = [...this.entries()];
    next.splice(idx, 1);
    this.entries.set(next);
  }

  isEpisodeSelected(id: string): boolean {
    return this.form.getRawValue().episodeSelection.includes(id);
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
    if (this.entryType === 'photo') this.refreshFramingHint();
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
    if (this.entryType === 'photo') this.refreshFramingHint();
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
    const { patientId, observedAt, text, startEpisodeName, episodeSelection, resolveSelected } =
      this.form.getRawValue();
    const episodeIds = (episodeSelection || []).filter((id) => id !== '__new__');
    // Records the units this caregiver actually had on screen. Entry metadata is already canonical
    // — this is provenance for whoever reads the entry later (api.md → Observations).
    const unitPreferenceAtEntry: UnitPreference = {
      temp: user.preferredTempUnit,
      weight: user.preferredWeightUnit,
      length: user.preferredLengthUnit,
    };
    const payload: any = {
      observedAt: new Date(observedAt).toISOString(),
      text: text ?? undefined,
      startEpisodeName: this.createNewEpisode() ? startEpisodeName || undefined : undefined,
      episodeIds: episodeIds.length ? episodeIds : undefined,
      resolvesEpisodeIds: resolveSelected && episodeIds.length ? episodeIds : undefined,
      unitPreferenceAtEntry,
      entries: this.entries(),
    };
    this.api.post<Observation>(`/patients/${patientId}/observations`, payload).subscribe({
      next: (res) => {
        this.saving.set(false);
        // Protocol trips (F-4.10) render as a card the caregiver must acknowledge before moving
        // on, rather than being swept away by an immediate navigation (frontend.md → "Protocol card").
        if (res.firedAdvisories?.length) {
          this.firedAdvisories.set(res.firedAdvisories);
        } else {
          this.router.navigateByUrl('/dashboard');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save observation.'));
      },
    });
  }

  continueToDashboard() {
    this.router.navigateByUrl('/dashboard');
  }

  cancel() {
    this.router.navigateByUrl('/dashboard');
  }
}
