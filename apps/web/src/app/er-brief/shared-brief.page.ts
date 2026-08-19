import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { describeEvent } from '../core/event-display';
import { ErBriefEventScope, SharedErBriefResponse, TimelineEntry } from '@salud/shared/types';
import { BriefCareDocumentsComponent } from './brief-care-documents.component';

// Public route — no authGuard (er-brief.md → "Frozen snapshot"). Renders exactly what the
// caregiver saw at the moment the link was created; a 404 renders as one plain message, with no
// distinction between "never existed" and "expired" (mirrors the API's own non-disclosure).
@Component({
  selector: 'app-shared-brief-page',
  standalone: true,
  imports: [CommonModule, BriefCareDocumentsComponent],
  template: `
    <div class="page">
      <p class="error" *ngIf="notFound()">This link has expired or doesn't exist.</p>

      <ng-container *ngIf="snapshot() as s">
        <div class="frozen-banner">
          Frozen {{ s.frozenAt * 1000 | date: 'medium' }} · expires {{ s.expiresAt * 1000 | date: 'medium' }}
        </div>

        <header class="brief-header">
          <h1>{{ s.payload.header.patient.fullName }}</h1>
          <p class="identity">
            {{ s.payload.header.patient.sexAtBirth }} · {{ s.payload.header.patient.ageYears }}y —
            DOB {{ s.payload.header.patient.dateOfBirth }}
          </p>
          <div class="field-row">
            <span class="label">Weight</span>
            <span *ngIf="s.payload.header.latestWeight as w">
              {{ w.kg }} kg — recorded {{ w.recordedAt * 1000 | date: 'medium' }}
            </span>
            <span *ngIf="!s.payload.header.latestWeight" class="missing">No weight on file</span>
          </div>
          <div class="field-row code-status" [class.missing]="!s.payload.header.codeStatus">
            <span class="label">Code status</span>
            <span *ngIf="s.payload.header.codeStatus as cs">
              {{ cs.value }} — set by {{ cs.setByName }}, {{ cs.setAt * 1000 | date: 'medium' }}
            </span>
            <span *ngIf="!s.payload.header.codeStatus" class="missing">NOT SET</span>
          </div>
          <app-brief-care-documents
            [documents]="s.payload.header.careDocuments"
            [frozenAt]="s.frozenAt"
            [shareToken]="token"
          ></app-brief-care-documents>

          <div class="protocol-banner" *ngIf="s.payload.header.protocolFiredReason as pr">
            <strong>Reason for visit:</strong> {{ pr.protocolName }} — {{ pr.instructionText }}
          </div>
          <div class="field-row" *ngIf="s.payload.header.dangerReactions.length">
            <span class="label">Danger reactions</span>
            <ul>
              <li *ngFor="let r of s.payload.header.dangerReactions">{{ r.description }} ({{ r.scopeType }})</li>
            </ul>
          </div>
          <div class="field-row" *ngIf="s.payload.header.activeConditions.length">
            <span class="label">Active conditions</span>
            <div class="condition" *ngFor="let c of s.payload.header.activeConditions">
              <strong>{{ c.name }}</strong>
              <span *ngIf="c.diagnosisText"> — {{ c.diagnosisText }}</span>
            </div>
          </div>
        </header>

        <section class="section" *ngIf="s.payload.body.episode as ep">
          <h2>Episode: {{ ep.name }}</h2>
        </section>

        <!-- From the frozen values, not from the words "the last 72 hours". This document is read
             days after it was taken; a relative claim would simply be false by then. -->
        <section class="section" *ngIf="recentScope(s.payload) as scope">
          <h2>No open episode</h2>
          <p class="muted small">
            Everything logged in the {{ scope.windowHours }} hours before this brief was frozen —
            {{ scope.since * 1000 | date: 'medium' }} to {{ scope.generatedAt * 1000 | date: 'medium' }}.
          </p>
        </section>

        <section class="section">
          <h2>Events</h2>
          <ul class="events" *ngIf="s.payload.body.events.length">
            <li *ngFor="let e of s.payload.body.events">
              <span class="ts">{{ e.timestamp * 1000 | date: 'short' }}</span>
              <span class="kind">{{ e.kind }}</span>
              <span>{{ describeEvent(e) }}</span>
            </li>
          </ul>
          <p class="muted small" *ngIf="!s.payload.body.events.length">
            {{
              recentScope(s.payload)
                ? 'Nothing logged in the ' + recentScope(s.payload)!.windowHours + ' hours before this brief was frozen.'
                : 'No events recorded for this episode.'
            }}
          </p>
        </section>

        <section class="section" *ngIf="s.payload.body.activeSchedules.length">
          <h2>Current medication situation</h2>
          <!-- Same treatment as the authed page, and it matters more here: this is the public link
               a clinician actually opens, on a phone, at a triage desk. -->
          <div class="table-scroll">
          <table>
            <thead>
              <tr><th>Schedule</th><th>Medication</th><th>Last dose</th><th>mg/kg</th><th>Next allowed</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let sc of s.payload.body.activeSchedules">
                <td>{{ sc.label }}</td>
                <td>{{ sc.medicationName || '—' }}</td>
                <td>{{ sc.lastDoseMg !== null ? (sc.lastDoseMg + ' mg') : '—' }}</td>
                <td>{{ sc.lastDoseMgPerKg ?? '—' }}</td>
                <td>{{ sc.nextAllowedAt ? (sc.nextAllowedAt * 1000 | date: 'short') : '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </section>

        <!-- Print only, same reasoning as the authenticated page: paper is a snapshot with no
             expiry. Dated from the freeze, not from now — this copy has been frozen all along. -->
        <footer class="print-footer">
          Frozen {{ s.frozenAt * 1000 | date: 'medium' }} — verify documents are current.
        </footer>
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
        padding: 1.5rem;
      }
      .error {
        font-size: 1.1rem;
      }
      .frozen-banner {
        padding: 0.5rem 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        background: rgba(148, 163, 184, 0.1);
        color: #cbd5e1;
        font-size: 0.85rem;
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
        padding: 0.35rem 0;
      }
      .section {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        padding: 1rem;
      }
      .events li {
        font-size: 0.9rem;
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
      .table-scroll {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .table-scroll table {
        min-width: 414px;
      }
      /* This page had no print styles at all. It needs them now that the table scrolls -- and it
         is the copy most likely to be printed, being the one handed to a clinician. */
      .print-footer {
        display: none;
      }
      @media print {
        .table-scroll {
          overflow: visible;
        }
        .table-scroll table {
          min-width: 0;
        }
        .section {
          break-inside: avoid;
        }
        .print-footer {
          display: block;
          margin-top: 0.75rem;
          padding-top: 0.5rem;
          border-top: 1px solid #999;
          font-size: 0.75rem;
          font-style: italic;
        }
      }
    `,
  ],
})
export class SharedBriefPage implements OnInit {
  /** See the matching helper on ErBriefPage. */
  recentScope(payload: { body: { eventScope?: ErBriefEventScope } }) {
    const scope = payload.body.eventScope;
    return scope && scope.type === 'recent' ? scope : null;
  }

  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);

  snapshot = signal<SharedErBriefResponse | null>(null);
  notFound = signal(false);
  /** Held so care-document files can be fetched through this snapshot's own token-scoped route. */
  token = '';

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.token = token;
    this.api.get<SharedErBriefResponse>(`/er-brief/shared/${token}`).subscribe({
      next: (res) => this.snapshot.set(res),
      error: () => this.notFound.set(true),
    });
  }

  // No signed-in viewer on this public route, so values render in canonical units — the helper's
  // default. Nothing here may assume a UserProfile exists.
  describeEvent(entry: TimelineEntry): string {
    return describeEvent(entry);
  }
}
