import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { nextDoseLabel, timeAgo } from '../core/relative-time';
import { DashboardPayload, Patient, RecentMedication } from '@salud/shared/types';

type Step = 'patient' | 'verb' | 'dose';

/** The sheet speaks verbs. "Observation", "intervention" and "embodiment" are persistence words. */
interface Verb {
  key: string;
  label: string;
  icon: string;
}

const VERBS: Verb[] = [
  { key: 'temperature', label: 'Temp', icon: '🌡️' },
  { key: 'dose', label: 'Dose', icon: '💊' },
  { key: 'pain_score', label: 'Pain', icon: '😖' },
  { key: 'note', label: 'Note', icon: '📝' },
  { key: 'photo', label: 'Photo', icon: '📷' },
];

/**
 * Quick Log — the core loop, on P7's budget: under 30 seconds, one-handed, in a dark room, and a
 * repeat dose in at most four taps (frontend.md → "Information architecture (v2)" → Quick Log).
 *
 * A sheet, not a page: it never takes over the URL, so backing out of it leaves the caregiver
 * exactly where they were. Every verb hands off to the *existing* entry form with patient and
 * entry type pre-selected — one form codepath, no parallel implementation — which is why nothing
 * here posts to the API.
 *
 * Patient scoping is the wrong-chart guard (frontend.md → "Patient identity"): pre-scoped inside a
 * hub, skipped entirely for a single-patient household, and otherwise chips ordered sick-first.
 * The chosen name stays pinned at the top of the sheet, and the form it hands off to names the
 * patient again on the save button.
 */
@Component({
  selector: 'app-quick-log-sheet',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- A real button, not a click-handled div: the scrim has to be reachable without a mouse. -->
    <button type="button" class="ql-backdrop" aria-label="Close quick log" (click)="dismiss.emit()"></button>
    <section
      class="ql-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Quick log"
      data-testid="quick-log-sheet"
    >
      <header class="ql-head">
        <div class="ql-grabber" aria-hidden="true"></div>
        <div class="ql-title">
          <!-- Pinned through save: which chart this is going on is never off-screen. -->
          <strong *ngIf="selectedPatient() as p" data-testid="quick-log-patient">{{ p.fullName }}</strong>
          <span *ngIf="!selectedPatient()">Quick log</span>
          <button
            type="button"
            class="link small"
            *ngIf="selectedPatient() && patients().length > 1 && !lockedPatientId"
            (click)="changePatient()"
          >
            change
          </button>
        </div>
        <button type="button" class="ql-close" aria-label="Close quick log" (click)="dismiss.emit()">✕</button>
      </header>

      <p class="error small" *ngIf="error()">{{ error() }}</p>

      <ng-container [ngSwitch]="step()">
        <div *ngSwitchCase="'patient'" class="ql-body">
          <p class="muted small">Who is this for?</p>
          <p class="muted small" *ngIf="loadingPatients()">Loading patients…</p>
          <div class="chip-row">
            <button
              type="button"
              class="chip chip-lg"
              *ngFor="let p of orderedPatients()"
              (click)="choosePatient(p.id)"
            >
              {{ p.fullName }}
              <span class="pill pill-danger" *ngIf="sickPatientIds().has(p.id)">sick</span>
            </button>
          </div>
        </div>

        <div *ngSwitchCase="'verb'" class="ql-body">
          <div class="ql-verbs">
            <button
              type="button"
              class="ql-verb"
              *ngFor="let v of verbs"
              [attr.data-verb]="v.key"
              (click)="chooseVerb(v.key)"
            >
              <span class="ql-verb-icon" aria-hidden="true">{{ v.icon }}</span>
              <span>{{ v.label }}</span>
            </button>
          </div>
          <button type="button" class="link" (click)="fullObservation()">Full observation…</button>
        </div>

        <div *ngSwitchCase="'dose'" class="ql-body">
          <p class="muted small">Recent &amp; scheduled</p>
          <p class="muted small" *ngIf="loadingRecents()">Loading…</p>
          <p class="muted small" *ngIf="!loadingRecents() && !recents().length">
            Nothing given in the last 14 days and no active schedule — search for a medication instead.
          </p>
          <ul class="ql-recents">
            <li *ngFor="let r of recents()">
              <button type="button" class="ql-recent" (click)="chooseRecent(r)">
                <span class="ql-recent-name">
                  {{ r.medicationName }}
                  <span class="pill pill-neutral" *ngIf="r.onActiveSchedule">scheduled</span>
                  <span class="pill pill-danger" *ngIf="r.isAtypicalLastDose">atypical</span>
                </span>
                <span class="muted small" *ngIf="r.lastEmbodimentLabel">{{ r.lastEmbodimentLabel }}</span>
                <span class="ql-recent-amount" *ngIf="amountLabel(r) as amount">{{ amount }}</span>
                <span class="muted small">{{ lastDoseLabel(r) }}</span>
                <span class="ql-countdown" *ngIf="countdownLabel(r) as countdown">{{ countdown }}</span>
              </button>
            </li>
          </ul>
          <button type="button" class="link" (click)="searchInstead()">Something else…</button>
        </div>
      </ng-container>
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 60;
      }
      .ql-backdrop {
        position: absolute;
        inset: 0;
        border: none;
        padding: 0;
        background: rgba(0, 0, 0, 0.55);
        cursor: pointer;
      }
      .ql-sheet {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        max-height: 85vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.6rem 1rem calc(1.25rem + env(safe-area-inset-bottom));
        background: var(--bg-elevated);
        border-top: 1px solid var(--border-strong);
        border-radius: var(--radius-card) var(--radius-card) 0 0;
        box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
      }
      @media (min-width: 900px) {
        .ql-sheet {
          left: 50%;
          right: auto;
          bottom: auto;
          top: 12vh;
          transform: translateX(-50%);
          width: min(520px, 92vw);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-card);
        }
      }
      .ql-grabber {
        width: 2.5rem;
        height: 0.25rem;
        border-radius: var(--radius-pill);
        background: var(--border-strong);
        margin: 0 auto;
      }
      .ql-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        position: relative;
      }
      .ql-grabber {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
      }
      .ql-title {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        padding-top: 0.6rem;
        font-size: 1.05rem;
      }
      .ql-close {
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 1.1rem;
        cursor: pointer;
        padding: 0.35rem 0.5rem;
      }
      .ql-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.6rem;
      }
      .ql-verbs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
        gap: 0.5rem;
        width: 100%;
      }
      .ql-verb {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        /* Thumb-sized, in the dark, one-handed (P7) — not a text link. */
        min-height: 5rem;
        padding: 0.75rem 0.4rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border-strong);
        background: var(--surface-raised);
        color: var(--text);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .ql-verb-icon {
        font-size: 1.5rem;
      }
      .ql-recents {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
      }
      .ql-recent {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.2rem;
        min-height: 3.5rem;
        padding: 0.7rem 0.85rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border-strong);
        background: var(--surface-raised);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .ql-recent-name {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-weight: 700;
      }
      .ql-recent-amount {
        font-size: 1.15rem;
        font-weight: 700;
      }
      /* It answers the founding question ("did I already give Tylenol?"), so it is the loudest
         thing on the card, not a muted suffix (frontend.md → Home). */
      .ql-countdown {
        font-weight: 700;
        color: var(--accent-soft);
      }
    `,
  ],
})
export class QuickLogSheetComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);

  /** Set when the sheet opens inside a patient hub — already scoped, so the question is skipped. */
  @Input() lockedPatientId: string | null = null;

  /** Not `close`: an output named after a standard DOM event shadows it on the host element. */
  @Output() dismiss = new EventEmitter<void>();

  verbs = VERBS;

  patients = signal<Patient[]>([]);
  loadingPatients = signal(true);
  patientId = signal<string | null>(null);
  sickPatientIds = signal<Set<string>>(new Set<string>());
  /** Most recent event per patient, epoch seconds — the tiebreak once sickness is equal. */
  lastEventAt = signal<Record<string, number>>({});
  step = signal<Step>('verb');
  recents = signal<RecentMedication[]>([]);
  loadingRecents = signal(false);
  error = signal<string | null>(null);

  selectedPatient = computed(() => this.patients().find((p) => p.id === this.patientId()) ?? null);

  /** Sick-first: an active episode outranks a quiet patient, then the most recent event. */
  orderedPatients = computed(() => {
    const sick = this.sickPatientIds();
    const seen = this.lastEventAt();
    return [...this.patients()].sort((a, b) => {
      const sickDelta = Number(sick.has(b.id)) - Number(sick.has(a.id));
      if (sickDelta) return sickDelta;
      const recencyDelta = (seen[b.id] ?? 0) - (seen[a.id] ?? 0);
      if (recencyDelta) return recencyDelta;
      return a.fullName.localeCompare(b.fullName);
    });
  });

  ngOnInit(): void {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (res) => {
        this.patients.set(res);
        this.loadingPatients.set(false);
        if (this.lockedPatientId) {
          this.patientId.set(this.lockedPatientId);
          this.step.set('verb');
          return;
        }
        // A single-patient household is never asked the question at all.
        if (res.length === 1) {
          this.patientId.set(res[0].id);
          this.step.set('verb');
          return;
        }
        this.step.set('patient');
        this.loadSickness();
      },
      error: (err) => {
        this.loadingPatients.set(false);
        this.error.set(errorText(err, 'Could not load patients.'));
      },
    });
  }

  /**
   * Sick-first ordering, from the one payload that already knows: `GET /api/dashboard` carries
   * active episodes and last doses per patient. Only fetched when there is actually a choice to
   * order, and a failure just leaves the chips in name order rather than blocking the log.
   */
  private loadSickness(): void {
    this.api.get<DashboardPayload>('/dashboard').subscribe({
      next: (res) => {
        this.sickPatientIds.set(new Set(res.activeEpisodes.map((e) => e.patientId)));
        const seen: Record<string, number> = {};
        const mark = (patientId: string, ts: number | null | undefined) => {
          if (ts == null) return;
          if (!seen[patientId] || ts > seen[patientId]) seen[patientId] = ts;
        };
        for (const episode of res.activeEpisodes) {
          mark(episode.patientId, episode.lastObservationSummary?.observedAt);
          for (const med of episode.medications) mark(episode.patientId, med.lastDoseAt);
        }
        for (const row of res.lastDoses) {
          for (const dose of row.doses) mark(row.patientId, dose.lastDoseAt);
        }
        this.lastEventAt.set(seen);
      },
      error: () => undefined,
    });
  }

  changePatient() {
    this.step.set('patient');
    this.loadSickness();
  }

  choosePatient(id: string) {
    this.patientId.set(id);
    this.step.set('verb');
  }

  chooseVerb(key: string) {
    if (key === 'dose') {
      this.step.set('dose');
      this.loadRecents();
      return;
    }
    // Compact single-purpose layout on the existing multi-entry form: one entry type, no patient
    // dropdown, everything else about that form unchanged.
    this.go('/observations/new', { entryType: key, compact: '1' });
  }

  fullObservation() {
    this.go('/observations/new', {});
  }

  private loadRecents() {
    const patientId = this.patientId();
    if (!patientId) return;
    this.loadingRecents.set(true);
    this.recents.set([]);
    this.api.get<RecentMedication[]>(`/patients/${patientId}/recent-medications`).subscribe({
      next: (res) => {
        this.recents.set(res);
        this.loadingRecents.set(false);
      },
      error: (err) => {
        this.loadingRecents.set(false);
        this.error.set(errorText(err, 'Could not load recent medications.'));
      },
    });
  }

  /**
   * "Same as last time" — medication, embodiment and amount, handed to the dose form as a prefill.
   * It is a prefill and nothing more: dose-checks still run there, guidance cards still render
   * side by side, advisory banners and the danger interstitial still fire, and the caregiver still
   * reviews before "Save for ⟨name⟩" (P1 — guardrails, no gates).
   */
  chooseRecent(recent: RecentMedication) {
    const params: Record<string, string> = {
      type: 'medication_dose',
      compact: '1',
      medicationId: recent.medicationId,
    };
    if (recent.lastEmbodimentId) params['embodimentId'] = recent.lastEmbodimentId;
    if (recent.lastAmountMg != null) params['amountMg'] = String(recent.lastAmountMg);
    if (recent.lastAmountMl != null) params['amountMl'] = String(recent.lastAmountMl);
    // Including how they arrived at that amount: a repeat of a weight-based dose is not an
    // override, and recording it as one would flag it atypical for no reason the caregiver caused.
    if (recent.lastDoseSource) params['doseSource'] = recent.lastDoseSource;
    this.go('/interventions/new', params);
  }

  searchInstead() {
    this.go('/interventions/new', { type: 'medication_dose', compact: '1' });
  }

  private go(path: string, params: Record<string, string>) {
    const patientId = this.patientId();
    if (!patientId) return;
    this.dismiss.emit();
    this.router.navigate([path], { queryParams: { patientId, ...params } });
  }

  amountLabel(recent: RecentMedication): string | null {
    const parts: string[] = [];
    if (recent.lastAmountMg != null) parts.push(`${recent.lastAmountMg} mg`);
    if (recent.lastAmountMl != null) parts.push(`${recent.lastAmountMl} mL`);
    return parts.length ? parts.join(' · ') : null;
  }

  lastDoseLabel(recent: RecentMedication): string {
    // A confident negative, not a blank: "never given" is information a caregiver acts on.
    return recent.lastDoseAt === null ? 'never given' : `last ${timeAgo(recent.lastDoseAt)}`;
  }

  countdownLabel(recent: RecentMedication): string | null {
    return nextDoseLabel(recent.nextAllowedAt);
  }
}
