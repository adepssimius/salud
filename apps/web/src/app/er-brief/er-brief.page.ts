import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { describeEvent, photoFileIds, unitsFor } from '../core/event-display';
import { errorText } from '../core/error-display';
import {
  CreateErBriefSnapshotDto,
  ErBrief,
  ErBriefSnapshotResponse,
  ErBriefEventScope,
  ErBriefSnapshotSummary,
  TimelineEntry,
} from '@salud/shared/types';

@Component({
  selector: 'app-er-brief-page',
  standalone: true,
  imports: [CommonModule, PhotoThumbnailComponent],
  template: `
    <div class="page" [class.flash]="isFlash()">
      <div class="toolbar no-print">
        <button type="button" class="secondary" (click)="backToPatient()">← Patient</button>
        <div class="toolbar-actions">
          <button type="button" class="secondary" (click)="toggleFlash()">
            {{ isFlash() ? 'Full brief' : 'Flash view' }}
          </button>
          <button type="button" class="secondary" (click)="print()">Print / Save PDF</button>
          <button type="button" class="primary" (click)="createLink()" [disabled]="creatingLink()">
            {{ creatingLink() ? 'Creating…' : 'Create shareable link' }}
          </button>
        </div>
      </div>

      <div class="share-banner no-print" *ngIf="snapshot() as s">
        <span>Link created, expires {{ s.expiresAt * 1000 | date: 'medium' }}:</span>
        <code>{{ s.url }}</code>
        <button type="button" class="tiny" (click)="copyLink(s.url)">Copy</button>
      </div>

      <div class="section no-print" *ngIf="snapshots().length">
        <h2>Shareable links</h2>
        <ul class="row-list">
          <li *ngFor="let s of snapshots()">
            <span>Created {{ s.createdAt * 1000 | date: 'short' }} · expires {{ s.expiresAt * 1000 | date: 'short' }}</span>
            <button type="button" class="tiny" (click)="revokeSnapshot(s.id)">Revoke</button>
          </li>
        </ul>
      </div>

      <p class="error no-print" *ngIf="error()">{{ error() }}</p>

      <ng-container *ngIf="brief() as b">
        <header class="brief-header">
          <h1>{{ b.header.patient.fullName }}</h1>
          <p class="identity">
            {{ b.header.patient.sexAtBirth }} · {{ b.header.patient.ageYears }}y
            ({{ b.header.patient.ageMonths }} mo) · DOB {{ b.header.patient.dateOfBirth }}
          </p>

          <div class="field-row">
            <span class="label">Weight</span>
            <span *ngIf="b.header.latestWeight as w">
              {{ w.kg }} kg — recorded {{ w.recordedAt * 1000 | date: 'medium' }}
            </span>
            <span *ngIf="!b.header.latestWeight" class="missing">No weight on file</span>
          </div>

          <div class="field-row code-status" [class.missing]="!b.header.codeStatus">
            <span class="label">Code status</span>
            <span *ngIf="b.header.codeStatus as cs">
              {{ cs.value }} — set by {{ cs.setByName }}, {{ cs.setAt * 1000 | date: 'medium' }}
            </span>
            <span *ngIf="!b.header.codeStatus" class="missing">NOT SET</span>
          </div>

          <div class="protocol-banner" *ngIf="b.header.protocolFiredReason as pr">
            <strong>Reason for visit:</strong> standing protocol <em>{{ pr.protocolName }}</em> —
            {{ pr.instructionText }} — fired at {{ pr.firedAt * 1000 | date: 'short' }} on
            {{ pr.triggerMetric }} {{ pr.observedValue }} ({{ pr.triggerOperator === 'gte' ? '≥' : '≤' }}
            {{ pr.triggerValue }}) — per {{ pr.sourceText }}.
          </div>

          <div class="field-row" *ngIf="b.header.dangerReactions.length">
            <span class="label">Danger reactions</span>
            <ul>
              <li *ngFor="let r of b.header.dangerReactions">
                {{ r.description }} ({{ r.scopeType }}) —
                <ng-container *ngIf="r.occurredAt; else dateUnknown">{{
                  r.occurredAt! * 1000 | date: 'mediumDate'
                }}</ng-container>
                <ng-template #dateUnknown><span class="muted">Date unknown</span></ng-template>
              </li>
            </ul>
          </div>

          <div class="field-row" *ngIf="b.header.activeConditions.length">
            <span class="label">Active conditions</span>
            <div class="condition" *ngFor="let c of b.header.activeConditions">
              <strong>{{ c.name }}</strong>
              <span *ngIf="c.diagnosisText"> — {{ c.diagnosisText }}</span>
              <div class="muted small" *ngIf="c.baselines.length">Baselines: {{ c.baselines.join(', ') }}</div>
              <div class="muted small" *ngIf="c.devices.length">Devices: {{ c.devices.join(', ') }}</div>
              <div class="muted small" *ngFor="let ct of c.contacts">{{ ct.name }} ({{ ct.role }}) — {{ ct.phone }}</div>
            </div>
          </div>
        </header>

        <section class="brief-body" *ngIf="!isFlash()">
          <div class="section" *ngIf="b.body.episode as ep">
            <h2>Episode: {{ ep.name }}</h2>
            <p class="muted small">
              {{ ep.status }} · started {{ ep.startedAt ? (ep.startedAt * 1000 | date: 'medium') : 'unknown' }}
              <span *ngIf="ep.endedAt"> · ended {{ ep.endedAt * 1000 | date: 'medium' }}</span>
            </p>
          </div>

          <!-- Read from the response, never assumed. Absolute times deliberately: the ER Brief is
               frontend.md's explicit exception to the relative-time rule used elsewhere. -->
          <div class="section" *ngIf="recentScope(b) as scope">
            <h2>No open episode</h2>
            <p class="muted small">
              Showing everything logged in the last {{ scope.windowHours }} hours — since
              {{ scope.since * 1000 | date: 'medium' }}.
            </p>
          </div>

          <div class="section">
            <h2>Events</h2>
            <ul class="events" *ngIf="b.body.events.length">
              <li *ngFor="let e of b.body.events">
                <span class="ts">{{ e.timestamp * 1000 | date: 'short' }}</span>
                <span class="kind">{{ e.kind }}</span>
                <span>{{ describeEvent(e) }}</span>
                <app-photo-thumbnail *ngFor="let fid of photoFileIds(e)" [fileId]="fid"></app-photo-thumbnail>
              </li>
            </ul>
            <!-- A confident negative, not a blank section: blank is ambiguous between "nothing
                 happened" and "the app doesn't know". -->
            <p class="muted small" *ngIf="!b.body.events.length">
              {{
                recentScope(b)
                  ? 'Nothing logged in the last ' + recentScope(b)!.windowHours + ' hours.'
                  : 'No events recorded for this episode.'
              }}
            </p>
          </div>

          <div class="section" *ngIf="b.body.activeSchedules.length">
            <h2>Current medication situation</h2>
            <!-- Six columns have a ~414px intrinsic minimum, so at 375px the page itself scrolled
                 sideways and the "next allowed" column went off the edge -- on the screen most
                 likely opened one-handed in a waiting room. Scroll the table, not the page. -->
            <div class="table-scroll">
            <table>
              <thead>
                <tr><th>Schedule</th><th>Medication</th><th>Last dose</th><th>mg/kg</th><th>When</th><th>Next allowed</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let s of b.body.activeSchedules">
                  <td>{{ s.label }}</td>
                  <td>{{ s.medicationName || '—' }}</td>
                  <td>{{ s.lastDoseMg !== null ? (s.lastDoseMg + ' mg') : '—' }}</td>
                  <td>{{ s.lastDoseMgPerKg !== null ? s.lastDoseMgPerKg : '—' }}</td>
                  <td>{{ s.lastDoseAt ? (s.lastDoseAt * 1000 | date: 'short') : '—' }}</td>
                  <td>{{ s.nextAllowedAt ? (s.nextAllowedAt * 1000 | date: 'short') : '—' }}</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>

          <div class="section" *ngIf="b.body.priorEpisodes.length">
            <h2>{{ recentScope(b) ? 'Recent episodes' : 'Prior episodes under this condition' }}</h2>
            <ul>
              <li *ngFor="let pe of b.body.priorEpisodes">
                <button type="button" class="link" (click)="goToEpisode(pe.id)">
                  {{ pe.name }} — {{ pe.status }}
                  <span *ngIf="pe.startedAt"> — started {{ pe.startedAt * 1000 | date: 'mediumDate' }}</span>
                </button>
              </li>
            </ul>
          </div>

          <div class="section" *ngIf="b.body.atypicalAdvisories.length">
            <h2>{{ recentScope(b) ? 'Atypical doses in this window' : 'Atypical doses this episode' }}</h2>
            <ul>
              <li *ngFor="let a of b.body.atypicalAdvisories">
                {{ a.payload?.['reasons']?.join(', ') || 'atypical' }} — amount
                {{ a.payload?.['amountMg'] }} mg — {{ a.createdAt * 1000 | date: 'short' }}
              </li>
            </ul>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      /* Explicit rather than inherited: these pages only set margin, so the header rendered at the
         UA's 2em. The global h1 is 1.6rem, and silently shrinking a header a paramedic reads off a
         printout is not a change to make by omission. */
      h1 {
        font-size: 2rem;
      }
      .page {
        max-width: 900px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        color: #e2e8f0;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .toolbar-actions {
        display: flex;
        gap: 0.5rem;
      }
      .share-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        padding: 0.6rem 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(34, 211, 238, 0.35);
        background: rgba(34, 211, 238, 0.08);
      }
      code {
        word-break: break-all;
      }
      .brief-header {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .identity {
        margin: 0;
        color: #cbd5e1;
      }
      .field-row {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .label {
        font-weight: 700;
        color: #94a3b8;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .missing {
        color: #fbbf24;
        font-weight: 700;
      }
      .code-status.missing {
        color: #fca5a5;
      }
      .protocol-banner {
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(248, 113, 113, 0.5);
        background: rgba(248, 113, 113, 0.1);
        color: #fecdd3;
      }
      .condition {
        padding: 0.5rem 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .condition:first-child {
        border-top: none;
      }
      .muted {
        color: #94a3b8;
      }
      .brief-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .section {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        padding: 1rem;
      }
      .link {
        color: inherit;
        font: inherit;
        text-align: left;
        text-decoration: underline;
        text-decoration-color: rgba(226, 232, 240, 0.3);
      }
      .events li {
        font-size: 0.9rem;
      }
      .row-list {
        gap: 0.4rem;
      }
      .row-list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.85rem;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .tiny {
        border: none;
        border-radius: var(--radius-control);
        font-weight: 700;
        cursor: pointer;
      }
      .tiny {
        padding: 0.25rem 0.55rem;
        background: rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        font-size: 0.8rem;
      }
      .page.flash .brief-header {
        font-size: 1.4rem;
      }
      .page.flash h1 {
        font-size: 2.6rem;
      }
      .page.flash .identity {
        font-size: 1.3rem;
      }
      .page.flash .label {
        font-size: 1rem;
      }
      .page.flash .protocol-banner {
        font-size: 1.3rem;
      }
      .table-scroll {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .table-scroll table {
        min-width: 414px;
      }
      @media print {
        .no-print {
          display: none !important;
        }
        /* A paramedic reads the printout in columns -- the real table has to survive printing. */
        .table-scroll {
          overflow: visible;
        }
        .table-scroll table {
          min-width: 0;
        }
        .page {
          max-width: none;
          color: #000;
        }
        .brief-header,
        .section {
          border-color: #999;
          background: none;
          break-inside: avoid;
        }
      }
    `,
  ],
})
export class ErBriefPage implements OnInit {
  /**
   * The recent-window scope, or null in episode mode. Reading it from the response rather than
   * inferring from `body.episode` is what keeps a *frozen* snapshot honest: it carries the absolute
   * window it was taken over, so a brief read three days later doesn't claim "the last 72 hours".
   */
  recentScope(b: { body: { eventScope?: ErBriefEventScope } }) {
    const scope = b.body.eventScope;
    return scope && scope.type === 'recent' ? scope : null;
  }

  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = '';
  brief = signal<ErBrief | null>(null);
  error = signal<string | null>(null);
  creatingLink = signal(false);
  snapshot = signal<ErBriefSnapshotResponse | null>(null);
  snapshots = signal<ErBriefSnapshotSummary[]>([]);
  mode = signal<string | null>(null);

  isFlash = computed(() => this.mode() === 'flash');

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.mode.set(this.route.snapshot.queryParamMap.get('mode'));
    this.load();
    this.loadSnapshots();
  }

  private load() {
    const episodeId = this.route.snapshot.queryParamMap.get('episodeId') ?? undefined;
    this.api
      .get<ErBrief>(`/patients/${this.patientId}/er-brief`, episodeId ? { episodeId } : {})
      .subscribe({
        next: (res) => this.brief.set(res),
        error: (err) => this.error.set(errorText(err, 'Unable to load the ER Brief.')),
      });
  }

  private loadSnapshots() {
    this.api.get<ErBriefSnapshotSummary[]>(`/patients/${this.patientId}/er-brief/snapshots`).subscribe({
      next: (res) => this.snapshots.set(res),
      error: () => this.snapshots.set([]),
    });
  }

  revokeSnapshot(id: string) {
    this.api.delete<{ deleted: boolean }>(`/er-brief/snapshots/${id}`).subscribe({
      next: () => this.snapshots.set(this.snapshots().filter((s) => s.id !== id)),
    });
  }

  describeEvent(entry: TimelineEntry): string {
    return describeEvent(entry, unitsFor(this.auth.user()));
  }

  // Photo entries render as thumbnails (F-8.2) rather than in the text line above.
  photoFileIds(entry: TimelineEntry): string[] {
    return photoFileIds(entry);
  }

  toggleFlash() {
    this.mode.set(this.isFlash() ? null : 'flash');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: this.isFlash() ? 'flash' : null },
      queryParamsHandling: 'merge',
    });
  }

  print() {
    window.print();
  }

  createLink() {
    if (this.creatingLink()) return;
    this.creatingLink.set(true);
    const episodeId = this.brief()?.body.episode?.id;
    const body: CreateErBriefSnapshotDto = episodeId ? { episodeId } : {};
    this.api
      .post<ErBriefSnapshotResponse, CreateErBriefSnapshotDto>(`/patients/${this.patientId}/er-brief/snapshots`, body)
      .subscribe({
        next: (res) => {
          this.snapshot.set(res);
          this.creatingLink.set(false);
          this.loadSnapshots();
        },
        error: (err) => {
          this.error.set(errorText(err, 'Could not create a shareable link.'));
          this.creatingLink.set(false);
        },
      });
  }

  copyLink(url: string) {
    navigator.clipboard?.writeText(url);
  }

  backToPatient() {
    this.router.navigate(['/patients', this.patientId]);
  }

  goToEpisode(episodeId: string) {
    this.router.navigate(['/episodes', episodeId]);
  }
}
