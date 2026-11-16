import { Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
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
import { convertTemp, entrySummary, fromKg, fromCm, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import {
  CorrectionEpisodeState,
  correctionResolves,
  episodeCorrection,
  stableJson,
  toLocalDateTimeInput,
} from '../core/entry-correction';
import {
  Advisory,
  Observation,
  ObservationType,
  Patient,
  TEMPERATURE_METHODS,
  TemperatureMethod,
  TimelineResponse,
  UnitPreference,
  UpdateObservationDto,
  UpdateObservationEntry,
} from '@salud/shared/types';

/**
 * What `/observations/:id/edit` hands this form to correct (frontend.md → "Correcting an entry").
 * Loaded by EditObservationPage; the form itself never fetches the entry.
 */
export interface ObservationCorrectionContext {
  observation: Observation;
  patientName: string;
  /** Null when the recorder has left the care team — reads "Unknown caregiver", as on the detail page. */
  recordedByName: string | null;
  episodes: CorrectionEpisodeState;
}

/** A pending entry. On a correction an entry loaded from the record keeps its `id`. */
type EntryRow = EntryDraft & { id?: string };

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
      <h1>{{ correction() ? 'Correction saved' : 'Observation saved' }}</h1>
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
        <button type="button" class="primary" *ngIf="!correction()" (click)="continueToDashboard()">Continue to dashboard</button>
        <button type="button" class="primary" *ngIf="correction()" (click)="backToEntry()">Back to the entry</button>
      </div>
    </div>

    <ng-template #formCard>
    <div class="card">
      <h1>{{ heading() }}</h1>
      <p class="muted" *ngIf="!compact() && !correction()">Log an observation with one or more measurement entries.</p>

      <!-- What a correction does not change, as plain text rather than disabled controls
           (frontend.md → "Correcting an entry" → Fixed). -->
      <ng-container *ngIf="correction() as c">
        <p class="muted small fixed-fact">
          Recorded by {{ c.recordedByName ?? 'Unknown caregiver' }} · logged
          {{ c.observation.createdAt * 1000 | date: 'medium' }}
        </p>
        <p class="muted small fixed-fact" *ngIf="enteredInLabel() as entered">Entered in {{ entered }}</p>
      </ng-container>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <!-- Pinned identity: which chart this lands on is never off-screen, and the save button
             names it again at the point of commitment (frontend.md → "Patient identity"). -->
        <div class="for-patient" *ngIf="(compact() || correction()) && patientName()">
          <span class="muted small">For</span>
          <span class="for-patient-name">{{ patientName() }}</span>
        </div>
        <label class="field" *ngIf="!compact() && !correction()">
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
          *ngIf="!correction(); else correctionEpisodes"
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
        <ng-template #correctionEpisodes>
          <!-- The create picker, configured for a correction: no new episode, and the episode this
               entry started stays attached (frontend.md → "Correcting an entry" → Fixed). -->
          <app-episode-attachment
            [episodes]="correctionEpisodeOptions()"
            [selectedIds]="selectedEpisodeIds()"
            [allowCreateNew]="false"
            [lockedIds]="correctionLockedIds()"
            [resolveSelected]="correctionResolveSelected()"
            (selectedIdsChange)="setEpisodeSelection($event)"
            (resolveSelectedChange)="correctionResolveFlag.set($event)"
          ></app-episode-attachment>
        </ng-template>

        <p class="muted small" *ngIf="changingIndex() !== null">
          Changing the {{ entries()[changingIndex()!].type }} entry below — edit it here, then tap
          "Add entry" to put it back.
          <button type="button" class="link" (click)="stopChanging()">Keep it as it was</button>
        </p>

        <app-entry-metadata-form
          [patientId]="form.getRawValue().patientId"
          [referenceGroups]="framingReferences()"
          [lockedType]="lockedEntryType()"
          [initialTempMethod]="initialTempMethod()"
          (typeChange)="onEntryTypeChange($event)"
          (entryAdded)="addEntry($event)"
        ></app-entry-metadata-form>

        <ul class="entries">
          <li *ngFor="let e of entries(); let i = index" [class.changing]="changingIndex() === i">
            <span class="pill">{{ e.type }}</span>
            <app-photo-thumbnail *ngIf="e.type === 'photo'; else entryText" [fileId]="e.metadata?.fileId"></app-photo-thumbnail>
            <ng-template #entryText><span class="summary">{{ entrySummary(e) }}</span></ng-template>
            <!-- A lab value is carried through a correction untouched: hand-typing it is the
                 transcription risk the import exists to avoid (frontend.md → Documents). -->
            <span class="muted small" *ngIf="correction() && e.type === 'lab_result'">from the report — read-only</span>
            <button
              type="button"
              class="link change-entry"
              *ngIf="correction() && e.type !== 'lab_result' && e.type !== 'document'"
              (click)="changeEntry(i)"
            >
              Change
            </button>
            <button
              type="button"
              class="icon-button"
              *ngIf="!correction() || (e.type !== 'lab_result' && entries().length > 1)"
              [attr.aria-label]="correction() ? 'Remove this entry' : null"
              (click)="removeEntry(i)"
            >
              ✕
            </button>
          </li>
        </ul>
        <p class="muted small" *ngIf="correction() && entries().length === 1">
          An observation keeps at least one entry.
        </p>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || entries().length === 0 || changingIndex() !== null || saving()">
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
      .entries li.changing {
        outline: 1px dashed var(--accent);
        border-radius: 6px;
      }
      .change-entry {
        font-size: 0.85rem;
      }
      .fixed-fact {
        margin: 0;
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

  /** Set by EditObservationPage: this form corrects that observation instead of logging a new one. */
  correction = input<ObservationCorrectionContext | null>(null);
  private readonly composer = viewChild(EntryMetadataFormComponent);

  patients = signal<Patient[]>([]);
  activeEpisodes = signal<EpisodeOption[]>([]);
  createNewEpisode = signal(false);
  /** Set by Quick Log: one verb, one entry type, no patient dropdown. */
  compact = signal(false);
  lockedEntryType = signal<ObservationType | null>(null);
  /** Set by Home's Temp quick action: the patient's habitual measurement method, still editable. */
  initialTempMethod = signal<TemperatureMethod | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);
  entries = signal<EntryRow[]>([]);
  /** On a correction: the entry whose values are loaded into the composer to be changed. */
  changingIndex = signal<number | null>(null);
  correctionEpisodeOptions = signal<EpisodeOption[]>([]);
  /** The picker's "this resolves…" switch on a correction; null until the caregiver touches it. */
  correctionResolveFlag = signal<boolean | null>(null);
  correctionLockedIds = computed(() => {
    const started = this.correction()?.episodes.startedId;
    return started ? [started] : [];
  });
  private correctionResolvesIds = computed(() => {
    const c = this.correction();
    return c ? correctionResolves(c.episodes, this.formEpisodeIds(), this.correctionResolveFlag()) : [];
  });
  correctionResolveSelected = computed(() => this.correctionResolvesIds().length > 0);
  firedAdvisories = signal<Advisory[]>([]);

  // Mirrors the child form's current type so episode changes only refetch the framing references
  // when a photo is actually being composed.
  entryType: ObservationType = 'temperature';
  framingReferences = signal<PhotoReferenceGroup[]>([]);

  selectedEpisodeIds = computed(() => this.formEpisodeIds());
  private formEpisodeIds = signal<string[]>([]);

  patientName = computed(
    () =>
      this.correction()?.patientName ||
      (this.patients().find((p) => p.id === this.form.getRawValue().patientId)?.fullName ?? null),
  );

  /** Every write names its patient at the point of commitment — never a bare "Save" (P3). */
  saveLabel = computed(() => {
    const name = this.patientName();
    if (this.correction()) return name ? `Save correction for ${name}` : 'Save correction';
    return name ? `Save for ${name}` : 'Save observation';
  });

  heading = computed(() =>
    this.correction() ? 'Correct observation' : VERB_HEADINGS[this.lockedEntryType() ?? ''] ?? 'New Observation',
  );

  /** The units the *recorder* had on screen — provenance a correction does not change. */
  enteredInLabel = computed<string | null>(() => {
    const pref = this.correction()?.observation.unitPreferenceAtEntry;
    if (!pref) return null;
    return [`°${pref.temp}`, pref.weight, pref.length].join(' · ');
  });

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
    const correction = this.correction();
    if (correction) {
      this.startCorrection(correction);
      return;
    }
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

    // Home's Temp action passes the patient's last known method (api.md → GET /api/dashboard →
    // recentTemperatures.lastMethod). Validated against the enum, and 'unknown' never prefills —
    // that is the form's own default, not a habit worth asserting.
    const methodParam = params.get('method');
    if (methodParam && methodParam !== 'unknown' && TEMPERATURE_METHODS.includes(methodParam as TemperatureMethod)) {
      this.initialTempMethod.set(methodParam as TemperatureMethod);
    }

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
    const changing = this.changingIndex();
    if (changing !== null) {
      // The changed values go back in the entry's own place and keep its id, so the API updates
      // that entry rather than dropping it and adding a stranger.
      const next = [...this.entries()];
      next[changing] = { id: next[changing].id, ...draft };
      this.entries.set(next);
      this.changingIndex.set(null);
      return;
    }
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
    // Removing the last entry of a stored observation is voiding it, not correcting it
    // (frontend.md → "Correcting an entry"); the API would refuse it with AT_LEAST_ONE_ENTRY_REQUIRED.
    if (this.correction() && this.entries().length <= 1) return;
    if (this.changingIndex() !== null) this.changingIndex.set(null);
    const next = [...this.entries()];
    next.splice(idx, 1);
    this.entries.set(next);
  }

  submit() {
    if (this.correction()) {
      this.submitCorrection();
      return;
    }
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
    if (this.correction()) {
      this.backToEntry();
      return;
    }
    this.router.navigateByUrl('/dashboard');
  }

  // ── Correcting an entry (frontend.md → "Correcting an entry") ──────────────────────────────

  backToEntry() {
    this.router.navigate(['/observations', this.correction()!.observation.id]);
  }

  /** Pre-fills the form with the observation as stored. Entries stay exactly as stored until changed. */
  private startCorrection(c: ObservationCorrectionContext) {
    const obs = c.observation;
    this.form.patchValue({
      patientId: obs.patientId,
      observedAt: toLocalDateTimeInput(obs.observedAt),
      text: obs.text ?? '',
    });
    this.correctionEpisodeOptions.set(c.episodes.options);
    this.formEpisodeIds.set([...c.episodes.selectedIds]);
    this.form.patchValue({ episodeSelection: [...c.episodes.selectedIds] });
    this.entries.set(
      obs.entries.map((e) => ({ id: e.id, type: e.type, metadata: e.metadata ? { ...e.metadata } : {} })),
    );
  }

  /**
   * Loads one entry's values into the composer, converted into the reader's units — the same units
   * the composer converts back from when "Add entry" is tapped — and marks it as the one changing.
   */
  changeEntry(idx: number) {
    const composer = this.composer();
    const entry = this.entries()[idx];
    if (!composer || !entry) return;
    const m: any = entry.metadata ?? {};
    const units = unitsFor(this.auth.user());
    composer.entryType = entry.type;
    composer.onTypeChange(entry.type);
    composer.entryNote = m.note ?? '';
    switch (entry.type) {
      case 'temperature':
        composer.tempUnit = units.temp;
        composer.tempValue =
          typeof m.value === 'number' ? convertTemp(m.value, m.unit === 'F' ? 'F' : 'C', units.temp) : null;
        composer.tempMethod = m.method ?? 'unknown';
        break;
      case 'heart_rate':
        composer.numberValue = m.bpm ?? null;
        break;
      case 'respiratory_rate':
        composer.numberValue = m.breathsPerMin ?? null;
        break;
      case 'oxygen_saturation':
        composer.numberValue = m.percent ?? null;
        break;
      case 'weight':
        composer.numberValue = typeof m.kg === 'number' ? fromKg(m.kg, units.weight) : null;
        break;
      case 'height':
        composer.numberValue = typeof m.cm === 'number' ? fromCm(m.cm, units.length) : null;
        break;
      case 'pain_score':
        composer.painScore = m.score ?? null;
        break;
      case 'lesion_size':
        composer.lesionLength = typeof m.lengthCm === 'number' ? fromCm(m.lengthCm, units.length) : null;
        composer.lesionWidth = typeof m.widthCm === 'number' ? fromCm(m.widthCm, units.length) : null;
        composer.lesionDepth = typeof m.depthCm === 'number' ? fromCm(m.depthCm, units.length) : null;
        composer.bodyLocation = m.bodyLocation ?? '';
        composer.side = m.side ?? 'n/a';
        break;
      case 'symptom':
        composer.symptomTag = m.tag ?? '';
        composer.symptomSeverity = m.severity ?? null;
        break;
      case 'tag':
        composer.tagValue = m.tag ?? '';
        break;
      case 'note':
        composer.noteText = m.text ?? '';
        composer.noteSymptom = m.symptom ?? '';
        break;
      case 'photo':
        composer.photoUploadedFileId.set(m.fileId ?? null);
        composer.bodyLocation = m.bodyLocation ?? '';
        composer.side = m.side ?? 'n/a';
        composer.photoSize = typeof m.sizeCm === 'number' ? fromCm(m.sizeCm, units.length) : null;
        break;
      default:
        return;
    }
    // composer.onTypeChange() above already told this page about the type (typeChange → onEntryTypeChange).
    this.changingIndex.set(idx);
  }

  stopChanging() {
    this.changingIndex.set(null);
  }

  /**
   * The PATCH body: only what the caregiver changed (frontend.md → "Correcting an entry" → Save).
   * `entries` goes whole or not at all — the API replaces the list — with each stored entry
   * keeping its id and `labContext` (read-only enrichment) left off.
   */
  correctionBody(): UpdateObservationDto {
    const c = this.correction()!;
    const obs = c.observation;
    const { observedAt, text } = this.form.getRawValue();
    const body: UpdateObservationDto = {};

    if (observedAt !== toLocalDateTimeInput(obs.observedAt)) {
      body.observedAt = new Date(observedAt).toISOString();
    }
    if ((text ?? '') !== (obs.text ?? '')) body.text = text ? text : null;

    const episodes = episodeCorrection(c.episodes, {
      selectedIds: this.formEpisodeIds(),
      resolvesIds: this.correctionResolvesIds(),
    });
    if (episodes) Object.assign(body, episodes);

    const toWire = (e: { id?: string; type: ObservationType; metadata?: any }): UpdateObservationEntry => {
      const out: UpdateObservationEntry = { type: e.type, metadata: e.metadata ?? {} };
      return e.id ? { id: e.id, ...out } : out;
    };
    const current = this.entries().map(toWire);
    const stored = obs.entries.map((e) => toWire({ id: e.id, type: e.type, metadata: e.metadata ?? {} }));
    if (stableJson(current) !== stableJson(stored)) body.entries = current;

    return body;
  }

  private submitCorrection() {
    if (this.form.invalid || this.saving()) return;
    if (this.entries().length === 0) {
      this.error.set('Add at least one entry before saving.');
      return;
    }
    const body = this.correctionBody();
    // An untouched form sends nothing to rewrite — no request, no empty revision.
    if (!Object.keys(body).length) {
      this.backToEntry();
      return;
    }
    const id = this.correction()!.observation.id;
    this.saving.set(true);
    this.error.set(null);
    this.api.patch<Observation, UpdateObservationDto>(`/observations/${id}`, body).subscribe({
      next: (res) => {
        this.saving.set(false);
        // The protocol card is the moment of relevance and must not be navigated past.
        if (res.firedAdvisories?.length) {
          this.firedAdvisories.set(res.firedAdvisories);
        } else {
          this.backToEntry();
        }
      },
      error: (err) => {
        // The form keeps everything the caregiver typed; only the message changes.
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not save the correction.'));
      },
    });
  }
}
