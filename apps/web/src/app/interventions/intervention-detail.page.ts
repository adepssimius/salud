import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CareTeamMember,
  DoseSource,
  Episode,
  Intervention,
  InterventionSchedule,
  Medication,
  MedicationEmbodiment,
  MedicationGuideline,
} from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { RevisionHistoryComponent } from '../core/revision-history.component';
import { doseReasonLabel } from '../core/advisory-banner.component';
import { fromKg, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import { nextDoseLabel, timeAgo } from '../core/relative-time';

/** One labeled line in the provenance block. */
interface Fact {
  label: string;
  value: string;
}

/** An episode this intervention touches, and how it touches it. */
interface EpisodeLink {
  id: string;
  name: string;
  role: 'started' | 'resolved' | 'member';
}

/** How the caregiver arrived at the amount, in words (data-model.md → `DoseSource`). */
const DOSE_SOURCE_LABELS: Record<DoseSource, string> = {
  weight_based: 'Weight-based guideline',
  age_based: 'Age-band guideline',
  override: 'Override — no guideline followed',
  schedule: 'Logged from a schedule',
};

const GUIDELINE_TYPE_LABELS: Record<string, string> = {
  weight_based: 'weight-based',
  age_band: 'age band',
};

/**
 * Read-only intervention detail (frontend.md → "Observation & intervention detail").
 *
 * A dose's provenance — which guideline, which weight, whether it was atypical and why — is
 * computed at save time and then stored in `metadata` where nothing rendered it. This page answers
 * "why was it that much?" days later, which is the question the dosing engine's whole audit trail
 * exists to be able to answer.
 *
 * **View only**, like its observation sibling. `nextAllowedAt` in particular is shown exactly as it
 * was frozen at log time and is never recomputed here: re-deriving it against today's guideline
 * would quietly rewrite what the caregiver was told when they gave the dose.
 */
@Component({
  selector: 'app-intervention-detail-page',
  standalone: true,
  imports: [CommonModule, RevisionHistoryComponent],
  template: `
    <div class="card">
      <button type="button" class="link" (click)="backToJournal()">&larr; Journal</button>

      <p class="error" *ngIf="error()">{{ error() }}</p>

      <ng-container *ngIf="intervention() as iv">
        <div class="card-header">
          <div>
            <h1>{{ typeLabel() }}</h1>
            <p class="muted">
              {{ iv.performedAt * 1000 | date: 'medium' }}
              <span class="small">· {{ ago(iv.performedAt) }}</span>
            </p>
          </div>
          <div class="header-actions">
            <span class="pill pill-danger" *ngIf="isAtypical()">atypical</span>
          </div>
        </div>

        <p class="muted small attribution">
          Recorded by {{ recordedByName() ?? 'Unknown caregiver' }}
          <span *ngIf="iv.createdAt"> · logged {{ iv.createdAt * 1000 | date: 'medium' }}</span>
        </p>

        <p class="notes" *ngIf="iv.notes">{{ iv.notes }}</p>

        <p class="atypical-reason" *ngIf="atypicalReasons() as reasons">
          Flagged atypical — {{ reasons }}
        </p>

        <section>
          <h2>{{ iv.type === 'medication_dose' ? 'Dose' : 'Dressing change' }}</h2>

          <p class="med-line" *ngIf="medication() as med">
            <button type="button" class="link" (click)="goToMedication(med.id)">{{ med.name }}</button>
            <span class="muted small" *ngIf="embodiment() as emb"> · {{ emb.label }}</span>
          </p>

          <dl class="facts" *ngIf="facts().length; else noFacts">
            <ng-container *ngFor="let f of facts()">
              <dt class="muted small">{{ f.label }}</dt>
              <dd>{{ f.value }}</dd>
            </ng-container>
          </dl>
          <ng-template #noFacts>
            <p class="muted">Nothing was recorded beyond the time and the type.</p>
          </ng-template>

          <p class="muted small" *ngIf="schedule() as s">
            From schedule
            <button type="button" class="link" (click)="goToSchedule(s.id)">{{ s.label }}</button>
          </p>
        </section>

        <section *ngIf="episodeLinks().length">
          <h2>Episodes</h2>
          <div class="episode-links">
            <button type="button" class="pill episode-link" *ngFor="let ep of episodeLinks()" (click)="goToEpisode(ep.id)">
              {{ ep.name }}
              <span class="muted small" *ngIf="ep.role !== 'member'">· {{ ep.role }} by this entry</span>
            </button>
          </div>
        </section>

        <section>
          <h2>History</h2>
          <app-revision-history entityType="intervention" [entityId]="iv.id"></app-revision-history>
          <p class="muted small">Corrections are recorded here; this page does not edit.</p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 720px;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .link {
        align-self: flex-start;
      }
      .muted,
      .notes {
        margin: 0;
      }
      .attribution {
        margin-top: -0.4rem;
      }
      .atypical-reason {
        margin: 0;
        color: var(--danger-text);
        font-size: 0.88rem;
      }
      section {
        border-top: 1px solid var(--border);
        padding-top: 0.85rem;
      }
      .med-line {
        margin: 0 0 0.6rem;
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
        flex-wrap: wrap;
      }
      .med-line .link {
        font-size: 1.05rem;
      }
      /* Label/value pairs, labels in a fixed column so the numbers line up down the block. */
      .facts {
        display: grid;
        grid-template-columns: minmax(9rem, auto) 1fr;
        gap: 0.35rem 0.85rem;
        margin: 0;
      }
      .facts dd {
        margin: 0;
        word-break: break-word;
      }
      .episode-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .episode-link {
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
        color: var(--accent-soft);
      }
      @media (max-width: 560px) {
        .facts {
          grid-template-columns: 1fr;
          gap: 0.1rem 0;
        }
        .facts dd {
          margin-bottom: 0.4rem;
        }
      }
    `,
  ],
})
export class InterventionDetailPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  interventionId = this.route.snapshot.paramMap.get('id') ?? '';
  intervention = signal<Intervention | null>(null);
  medication = signal<Medication | null>(null);
  embodiment = signal<MedicationEmbodiment | null>(null);
  guideline = signal<MedicationGuideline | null>(null);
  schedule = signal<InterventionSchedule | null>(null);
  episodes = signal<Episode[]>([]);
  careTeam = signal<CareTeamMember[]>([]);
  error = signal<string | null>(null);

  private readonly units = computed(() => unitsFor(this.auth.user()));
  private readonly metadata = computed<any>(() => this.intervention()?.metadata ?? {});

  typeLabel = computed(() =>
    this.intervention()?.type === 'dressing_change' ? 'Dressing change' : 'Medication dose',
  );

  isAtypical = computed(() => !!this.metadata().isAtypical);

  /**
   * The stored `atypicalReason` codes in the same words the advisory banner uses. A dose flagged
   * "too soon since the last dose" at entry has to read the same way when it is read back — the
   * same flag described two ways reads as two different findings.
   */
  atypicalReasons = computed<string | null>(() => {
    const raw: string | null = this.metadata().atypicalReason ?? null;
    if (!raw) return null;
    return raw
      .split(',')
      .map((code: string) => code.trim())
      .filter(Boolean)
      .map(doseReasonLabel)
      .join(', ');
  });

  /** Attribution through the care team — see ObservationDetailPage for why it can come up empty. */
  recordedByName = computed<string | null>(() => {
    const iv = this.intervention();
    if (!iv) return null;
    return this.careTeam().find((m) => m.user.id === iv.recordedByUserId)?.user.displayName ?? null;
  });

  /**
   * The provenance block. Every value is reported as stored — the amounts, the inputs the engine
   * computed from, the guideline it cited and the countdown it froze. Nothing here is recalculated
   * (P6): a dose reads back as the decision that was actually made, not as today's arithmetic.
   */
  facts = computed<Fact[]>(() => {
    const iv = this.intervention();
    if (!iv) return [];
    const m = this.metadata();
    const units = this.units();
    const facts: Fact[] = [];

    if (iv.type === 'medication_dose') {
      if (m.amountMg != null) facts.push({ label: 'Amount', value: `${m.amountMg} mg` });
      if (m.amountMl != null) facts.push({ label: 'Volume', value: `${m.amountMl} mL` });
      if (m.pillCount != null) facts.push({ label: 'Pills', value: `${m.pillCount}` });
      if (m.doseSource) {
        facts.push({ label: 'Dose source', value: DOSE_SOURCE_LABELS[m.doseSource as DoseSource] ?? m.doseSource });
      }
      if (m.weightKgUsed != null) {
        facts.push({ label: 'Weight used', value: `${fromKg(m.weightKgUsed, units.weight)} ${units.weight}` });
      }
      if (m.ageMonthsUsed != null) facts.push({ label: 'Age used', value: `${m.ageMonthsUsed} months` });
      const guideline = this.guideline();
      if (guideline) {
        const type = GUIDELINE_TYPE_LABELS[guideline.type] ?? guideline.type;
        facts.push({ label: 'Guideline', value: `${guideline.source} (${type})` });
      } else if (m.guidelineId) {
        // The id is on the dose but the guideline itself did not load (deleted, or the fetch
        // failed). Saying so beats an empty row that reads as "no guideline was followed".
        facts.push({ label: 'Guideline', value: 'Cited, but no longer in the catalog' });
      }
      if (m.nextAllowedAt != null) {
        const countdown = nextDoseLabel(m.nextAllowedAt);
        const when = new Date(m.nextAllowedAt * 1000).toLocaleString();
        facts.push({ label: 'Next dose allowed', value: countdown ? `${when} — ${countdown}` : when });
      }
    } else {
      if (m.bodyLocation) facts.push({ label: 'Body location', value: m.bodyLocation });
      if (m.side && m.side !== 'n/a') facts.push({ label: 'Side', value: m.side });
      if (m.dressingType) facts.push({ label: 'Dressing type', value: m.dressingType });
    }

    return facts;
  });

  /** Union of membership and resolution links — see ObservationDetailPage for why it is a union. */
  episodeLinks = computed<EpisodeLink[]>(() => {
    const iv = this.intervention();
    if (!iv) return [];
    const resolves = new Set(iv.resolvesEpisodeIds ?? []);
    const ids = Array.from(new Set([...(iv.episodeIds ?? []), ...resolves]));
    const byId = new Map(this.episodes().map((ep) => [ep.id, ep]));
    return ids.map((id) => {
      const ep = byId.get(id);
      const started = ep?.startedAtType === 'intervention' && ep?.startedAtId === iv.id;
      return {
        id,
        name: ep?.name ?? 'Episode',
        role: resolves.has(id) ? 'resolved' : started ? 'started' : 'member',
      };
    });
  });

  ngOnInit(): void {
    if (!this.interventionId) return;
    this.load();
  }

  private load() {
    this.api.get<Intervention>(`/interventions/${this.interventionId}`).subscribe({
      next: (iv) => {
        this.intervention.set(iv);
        this.loadContext(iv);
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load this intervention.')),
    });
  }

  /**
   * Everything the stored ids point at. All of it is best-effort: the intervention itself is the
   * record, and a catalog row that has since been renamed away must not blank the dose that was
   * given. Each fetch that fails simply leaves its line off.
   */
  private loadContext(iv: Intervention) {
    this.api.get<Episode[]>(`/patients/${iv.patientId}/episodes`).subscribe({
      next: (eps) => this.episodes.set(eps),
      error: () => this.episodes.set([]),
    });
    this.api.get<CareTeamMember[]>(`/patients/${iv.patientId}/care-team`).subscribe({
      next: (members) => this.careTeam.set(members),
      error: () => this.careTeam.set([]),
    });

    const m: any = iv.metadata ?? {};
    if (m.medicationId) {
      this.api.get<Medication>(`/medications/${m.medicationId}`).subscribe({
        next: (med) => this.medication.set(med),
        error: () => this.medication.set(null),
      });
      if (m.medicationEmbodimentId) {
        this.api.get<MedicationEmbodiment[]>(`/medications/${m.medicationId}/embodiments`).subscribe({
          next: (list) => this.embodiment.set(list.find((e) => e.id === m.medicationEmbodimentId) ?? null),
          error: () => this.embodiment.set(null),
        });
      }
    }
    if (m.guidelineId) {
      this.api.get<MedicationGuideline>(`/guidelines/${m.guidelineId}`).subscribe({
        next: (g) => this.guideline.set(g),
        error: () => this.guideline.set(null),
      });
    }
    const scheduleId = iv.scheduleId ?? m.interventionScheduleId ?? null;
    if (scheduleId) {
      this.api.get<InterventionSchedule>(`/schedules/${scheduleId}`).subscribe({
        next: (s) => this.schedule.set(s),
        error: () => this.schedule.set(null),
      });
    }
  }

  ago(ts: number): string {
    return timeAgo(ts);
  }

  goToEpisode(episodeId: string) {
    this.router.navigate(['/episodes', episodeId]);
  }

  goToMedication(medicationId: string) {
    this.router.navigate(['/medications', medicationId]);
  }

  goToSchedule(scheduleId: string) {
    this.router.navigate(['/schedules', scheduleId]);
  }

  backToJournal() {
    const iv = this.intervention();
    this.router.navigate(iv ? ['/patients', iv.patientId, 'journal'] : ['/dashboard']);
  }
}
