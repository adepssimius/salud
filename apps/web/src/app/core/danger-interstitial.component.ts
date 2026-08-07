import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdvisoryDisplay } from './advisory-banner.component';

// Full-screen, heavier confirmation for a `danger`-class adverse reaction (§4.9, F-2.5). Still
// proceedable (P1, no hard stops) — the confirmation gets heavier, the door stays open. Backing
// out doesn't save anything; there's nothing to persist yet (advisories.md → "Two lifecycles").
@Component({
  selector: 'app-danger-interstitial',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="backdrop">
      <div class="panel" role="alertdialog" aria-modal="true">
        <div class="header">
          <span class="icon">⛔</span>
          <h2>Recorded danger-class reaction</h2>
        </div>
        <p class="lede">
          This patient has a recorded <strong>danger-class</strong> adverse reaction on file for
          this medication. Review before continuing.
        </p>
        <ul class="reactions">
          <li *ngFor="let a of advisories">
            {{ a.payload?.['description'] || 'No description recorded.' }}
          </li>
        </ul>
        <p class="muted">
          You can still proceed — this is a warning, not a block. Proceeding is recorded as a
          deliberate decision.
        </p>
        <div class="actions">
          <button type="button" class="secondary" (click)="backOut.emit()">Back out</button>
          <button type="button" class="proceed" (click)="proceed.emit()">I understand, proceed</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        padding: 1rem;
      }
      .panel {
        width: min(520px, 100%);
        background: #1a0b0e;
        border: 1px solid rgba(248, 113, 113, 0.5);
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      }
      .header {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .icon {
        font-size: 1.8rem;
      }
      h2 {
        margin: 0;
        color: #fecdd3;
      }
      .lede {
        color: #fecdd3;
        font-weight: 600;
      }
      .reactions {
        margin: 0.75rem 0;
        padding-left: 1.25rem;
        color: #fca5a5;
      }
      .muted {
        font-size: 0.9rem;
      }
      .actions {
        margin-top: 1.25rem;
      }
      .proceed {
        padding: 0.65rem 1.1rem;
        border-radius: var(--radius-control);
        font-weight: 700;
        cursor: pointer;
        border: none;
      }
      .proceed {
        background: linear-gradient(135deg, #f87171, #fb7185);
        color: #1a0b0e;
      }
    `,
  ],
})
export class DangerInterstitialComponent {
  @Input({ required: true }) advisories!: AdvisoryDisplay[];
  @Output() proceed = new EventEmitter<void>();
  @Output() backOut = new EventEmitter<void>();
}
