import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdvisorySeverity, AdvisoryType } from '@salud/shared/types';

const REASON_LABELS: Record<string, string> = {
  exceeds_max_per_dose: 'exceeds max per dose',
  exceeds_max_per_day: 'exceeds max per day',
  interval_too_short: 'too soon since the last dose',
  override: 'no guideline followed',
};

// Structurally compatible with both the persisted `Advisory` (nullable fields, from the DB) and
// the unpersisted `AdvisoryCandidate` (optional fields, from a preview) — this component only
// ever reads type/severity/payload, so it doesn't need to care which one it was handed.
export interface AdvisoryDisplay {
  type: AdvisoryType;
  severity: AdvisorySeverity;
  payload?: Record<string, any> | null;
}

@Component({
  selector: 'app-advisory-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="advisory" [class]="'severity-' + advisory.severity">
      <span class="icon">{{ icon() }}</span>
      <div class="body">
        <div class="title">{{ title() }}</div>
        <div class="detail" *ngIf="detail() as d">{{ d }}</div>
      </div>
    </div>
  `,
  styles: [
    `
      .advisory {
        display: flex;
        gap: 0.6rem;
        align-items: flex-start;
        padding: 0.65rem 0.85rem;
        border-radius: 10px;
        border: 1px solid;
      }
      .icon {
        line-height: 1;
        font-size: 1rem;
      }
      .title {
        font-weight: 700;
      }
      .detail {
        margin-top: 0.15rem;
        font-size: 0.88rem;
        opacity: 0.85;
      }
      .severity-info {
        background: rgba(56, 189, 248, 0.08);
        border-color: rgba(56, 189, 248, 0.3);
        color: #7dd3fc;
      }
      .severity-warning {
        background: rgba(251, 191, 36, 0.1);
        border-color: rgba(251, 191, 36, 0.35);
        color: #fcd34d;
      }
      .severity-danger {
        background: rgba(248, 113, 113, 0.12);
        border-color: rgba(248, 113, 113, 0.4);
        color: #fca5a5;
      }
    `,
  ],
})
export class AdvisoryBannerComponent {
  @Input({ required: true }) advisory!: AdvisoryDisplay;

  icon(): string {
    switch (this.advisory.severity) {
      case 'danger':
        return '⛔';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  }

  title(): string {
    const payload = this.advisory.payload ?? {};
    switch (this.advisory.type) {
      case 'atypical_dose': {
        const reasons: string[] = payload['reasons'] ?? [];
        return 'Atypical dose — ' + reasons.map((r) => REASON_LABELS[r] ?? r).join(', ');
      }
      case 'stale_weight':
        return payload['daysSince'] == null
          ? 'No weight on file'
          : `Weight is ${payload['daysSince']} days old`;
      case 'expired_embodiment':
        return 'This embodiment has expired';
      case 'running_low':
        return 'Running low';
      case 'reaction_warning':
        return 'Adverse reaction on file';
      case 'reaction_danger':
        return 'Dangerous adverse reaction on file';
      case 'protocol_fired':
        return 'Standing protocol triggered';
      default:
        return this.advisory.type;
    }
  }

  detail(): string | null {
    const payload = this.advisory.payload ?? {};
    if (this.advisory.type === 'stale_weight') {
      return 'Log a fresh weight before leaning on weight-based guidance.';
    }
    if (this.advisory.type === 'atypical_dose' && payload['dailyTotalMg'] != null) {
      return `Prospective daily total: ${payload['dailyTotalMg']} mg`;
    }
    if (this.advisory.type === 'expired_embodiment' && payload['expiresAt']) {
      return `Expired ${new Date(payload['expiresAt'] * 1000).toLocaleDateString()}`;
    }
    if ((this.advisory.type === 'reaction_warning' || this.advisory.type === 'reaction_danger') && payload['description']) {
      return payload['description'];
    }
    if (this.advisory.type === 'protocol_fired' && payload['instructionText']) {
      return payload['instructionText'];
    }
    return null;
  }
}
