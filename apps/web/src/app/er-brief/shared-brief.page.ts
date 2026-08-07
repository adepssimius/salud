import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { describeEvent } from '../core/event-display';
import { SharedErBriefResponse, TimelineEntry } from '@salud/shared/types';

// Public route — no authGuard (er-brief.md → "Frozen snapshot"). Renders exactly what the
// caregiver saw at the moment the link was created; a 404 renders as one plain message, with no
// distinction between "never existed" and "expired" (mirrors the API's own non-disclosure).
@Component({
  selector: 'app-shared-brief-page',
  standalone: true,
  imports: [CommonModule],
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

        <section class="section">
          <h2>Events</h2>
          <ul class="events" *ngIf="s.payload.body.events.length">
            <li *ngFor="let e of s.payload.body.events">
              <span class="ts">{{ e.timestamp * 1000 | date: 'short' }}</span>
              <span class="kind">{{ e.kind }}</span>
              <span>{{ describeEvent(e) }}</span>
            </li>
          </ul>
        </section>

        <section class="section" *ngIf="s.payload.body.activeSchedules.length">
          <h2>Current medication situation</h2>
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
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
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
        color: #fca5a5;
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
      h1 {
        margin: 0;
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
      h2 {
        margin: 0 0 0.5rem;
        font-size: 1.05rem;
      }
      .events {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .events li {
        display: flex;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .ts {
        color: #94a3b8;
        min-width: 100px;
      }
      .kind {
        text-transform: capitalize;
        min-width: 90px;
        color: #7dd3fc;
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
    `,
  ],
})
export class SharedBriefPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);

  snapshot = signal<SharedErBriefResponse | null>(null);
  notFound = signal(false);

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
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
