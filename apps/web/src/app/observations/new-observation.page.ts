import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import {
  EntryDraft,
  EntryMetadataFormComponent,
  PhotoReferenceGroup,
  photoSiteKey,
} from './entry-metadata-form.component';
import { EpisodeAttachmentComponent, EpisodeOption } from '../quick-log/episode-attachment.component';
import { entrySummary, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { Advisory, Observation, ObservationType, Patient, TimelineResponse, UnitPreference } from '@salud/shared/types';

/** The verbs Quick Log can hand off here, and the heading each one gets. */
const VERB_HEADINGS: Record<string, string> = {
  temperature: 'Log temperature',
  pain_score: 'Log pain',
  note: 'Add a note',
  photo: 'Add a photo',
};

const OBSERVATION_VERBS: ObservationType[] = ['temperature', 'pain_score', 'note', 'photo'];

@Component({
  selector: 'app-new-observation-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    PhotoThumbnailComponent,
    EntryMetadataFormComponent,
    EpisodeAttachmentComponent,
  ],
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
      <h1>{{ heading() }}</h1>
      <p class="muted" *ngIf="!compact()">Log an observation with one or more measurement entries.</p>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <!-- Pinned identity: which chart this lands on is never off-screen, and the save button
             names it again at the point of commitment (frontend.md → "Patient identity"). -->
        <div class="for-patient" *ngIf="compact() && patientName()">
          <span class="muted small">For</span>
          <span class="for-patient-name">{{ patientName() }}</span>
        </div>
        <label class="field" *ngIf="!compact()">
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

        <app-episode-attachment
          [episodes]="activeEpisodes()"
          [selectedIds]="selectedEpisodeIds()"
          [createNew]="createNewEpisode()"
          [newEpisodeName]="form.getRawValue().startEpisodeName"
          [resolveSelected]="!!form.getRawValue().resolveSelected"
          (selectedIdsChange)="setEpisodeSelection($event)"
          (createNewChange)="setCreateNew($event)"
          (newEpisodeNameChange)="form.patchValue({ startEpisodeName: $event })"
          (resolveSelectedChange)="form.patchValue({ resolveSelected: $event })"
        ></app-episode-attachment>

        <app-entry-metadata-form
          [patientId]="form.getRawValue().patientId"
          [referenceGroups]="framingReferences()"
          [lockedType]="lockedEntryType()"
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
            {{ saving() ? 'Saving…' : saveLabel() }}
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
  activeEpisodes = signal<EpisodeOption[]>([]);
  createNewEpisode = signal(false);
  /** Set by Quick Log: one verb, one entry type, no patient dropdown. */
  compact = signal(false);
  lockedEntryType = signal<ObservationType | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);
  entries = signal<EntryDraft[]>([]);
  firedAdvisories = signal<Advisory[]>([]);

  // Mirrors the child form's current type so episode changes only refetch the framing references
  // when a photo is actually being composed.
  entryType: ObservationType = 'temperature';
  framingReferences = signal<PhotoReferenceGroup[]>([]);

  selectedEpisodeIds = computed(() => this.formEpisodeIds());
  private formEpisodeIds = signal<string[]>([]);

  patientName = computed(
    () => this.patients().find((p) => p.id === this.form.getRawValue().patientId)?.fullName ?? null,
  );

  /** Every write names its patient at the point of commitment — never a bare "Save" (P3). */
  saveLabel = computed(() => {
    const name = this.patientName();
    return name ? `Save for ${name}` : 'Save observation';
  });

  heading = computed(() => VERB_HEADINGS[this.lockedEntryType() ?? ''] ?? 'New Observation');

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

    const params = this.route.snapshot.queryParamMap;
    const patientIdParam = params.get('patientId');
    if (patientIdParam) this.form.patchValue({ patientId: patientIdParam });
    this.resolveEpisodeIdParam = params.get('resolveEpisodeId');

    // Quick Log's handoff: one verb already chosen, so the form renders its compact single-purpose
    // layout over the same codepath rather than a second implementation of it.
    const entryTypeParam = params.get('entryType');
    if (entryTypeParam && OBSERVATION_VERBS.includes(entryTypeParam as ObservationType)) {
      this.lockedEntryType.set(entryTypeParam as ObservationType);
      this.entryType = entryTypeParam as ObservationType;
    }
    this.compact.set(params.get('compact') === '1' && !!patientIdParam);

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
    this.api.get<EpisodeOption[]>(`/patients/${patientId}/episodes`, { status: 'active' }).subscribe({
      next: (eps) => {
        this.activeEpisodes.set(eps);
        if (this.resolveEpisodeIdParam && eps.some((ep) => ep.id === this.resolveEpisodeIdParam)) {
          this.setEpisodeSelection([this.resolveEpisodeIdParam]);
          this.form.patchValue({ resolveSelected: true });
          this.resolveEpisodeIdParam = null; // only ever apply this once, on the first successful load
          return;
        }
        // A visible default, never a silent inference (P5): exactly one active episode is
        // pre-attached — zero taps — and the chip stays on screen for the caregiver to reject
        // before saving. Two or more, and the app declines to guess.
        this.setEpisodeSelection(eps.length === 1 ? [eps[0].id] : []);
      },
      error: () => {
        this.activeEpisodes.set([]);
        this.setEpisodeSelection([]);
      },
    });
  }

  setEpisodeSelection(ids: string[]) {
    this.formEpisodeIds.set(ids);
    const withNew = this.createNewEpisode() ? [...ids, '__new__'] : ids;
    this.form.patchValue({ episodeSelection: withNew });
    if (this.entryType === 'photo') this.refreshFramingReferences();
  }

  setCreateNew(checked: boolean) {
    this.createNewEpisode.set(checked);
    if (!checked) this.form.patchValue({ startEpisodeName: '' });
    this.setEpisodeSelection(this.formEpisodeIds());
  }

  addEntry(draft: EntryDraft) {
    this.error.set(null);
    this.entries.set([...this.entries(), draft]);
  }

  onEntryTypeChange(type: ObservationType) {
    this.entryType = type;
    this.error.set(null);
    if (type === 'photo') {
      this.refreshFramingReferences();
    }
  }

  // One-line human summary for the pending-entries list, so a caregiver reviewing what they're
  // about to save reads values rather than field names. Shown in their own units — the entries were
  // just converted to canonical on the way in, so this converts back for display.
  entrySummary(entry: EntryDraft): string {
    return entrySummary(entry, unitsFor(this.auth.user()));
  }

  private refreshFramingReferences() {
    const { patientId, episodeSelection } = this.form.getRawValue();
    const episodeId = (episodeSelection || []).find((id) => id !== '__new__');
    if (!patientId || !episodeId) {
      this.framingReferences.set([]);
      return;
    }
    this.api.get<TimelineResponse>(`/patients/${patientId}/timeline`, { episodeId }).subscribe({
      next: (res) => {
        const photoEntries = res.entries
          .filter((e) => e.kind === 'observation')
          .flatMap((e) =>
            ((e.display as any).entries ?? [])
              .filter((x: any) => x.type === 'photo' && x.metadata?.fileId)
              .map((x: any) => ({
                timestamp: e.timestamp,
                fileId: x.metadata.fileId as string,
                bodyLocation: ((x.metadata.bodyLocation as string) ?? '').trim(),
                side: ((x.metadata.side as PhotoReferenceGroup['side']) ?? 'n/a') as PhotoReferenceGroup['side'],
              })),
          )
          .sort((a, b) => b.timestamp - a.timestamp);
        // One group per photographed site, ordered by the recency of each site's latest photo —
        // which, iterating newest-first, is the group's first occurrence (F-8.2 v2).
        const groups = new Map<string, PhotoReferenceGroup>();
        for (const p of photoEntries) {
          const existing = groups.get(photoSiteKey(p.bodyLocation, p.side));
          if (existing) {
            existing.count++;
          } else {
            groups.set(photoSiteKey(p.bodyLocation, p.side), {
              bodyLocation: p.bodyLocation,
              side: p.side,
              fileId: p.fileId,
              timestamp: p.timestamp,
              count: 1,
            });
          }
        }
        this.framingReferences.set([...groups.values()]);
      },
      error: () => this.framingReferences.set([]),
    });
  }

  removeEntry(idx: number) {
    const next = [...this.entries()];
    next.splice(idx, 1);
    this.entries.set(next);
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
