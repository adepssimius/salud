import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoseCheckResult } from '@salud/shared/types';

/**
 * The weight-based and age-band guidance cards, side by side at the same visual weight with
 * neither pre-selected (frontend.md → "Dose entry", F-2.1, P2). Shared by the dose form and the
 * schedule form so a schedule's amount is chosen against exactly what a dose's would be. The host
 * owns the amounts: "Use this" only reports which card was chosen.
 */
@Component({
  selector: 'app-dose-guidance',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="guidance-cards">
      <div class="guidance-card" *ngIf="result?.guidance?.weightBased as wb">
        <div class="guidance-header">
          <span class="pill">Weight-based</span>
        </div>
        <div class="guidance-amount">
          {{ wb.computedMg | number: '1.0-1' }} mg<span *ngIf="wb.computedMl"> ({{ wb.computedMl }} mL)</span>
        </div>
        <div class="muted small">
          {{ wb.mgPerKg }} mg/kg × {{ wb.weightKgUsed }} kg
          <span *ngIf="wb.maxMgPerDose"> · max {{ wb.maxMgPerDose }} mg/dose</span>
        </div>
        <div class="muted small">Source: {{ wb.source }}</div>
        <button type="button" class="secondary small" (click)="useWeightBased.emit()">Use this</button>
      </div>
      <div class="guidance-card" *ngIf="result?.guidance?.ageBand as ab">
        <div class="guidance-header">
          <span class="pill">Age-band</span>
        </div>
        <div class="guidance-amount">
          {{ ab.doseMg }} mg<span *ngIf="ab.doseMl"> ({{ ab.doseMl }} mL)</span>
        </div>
        <div class="muted small">{{ ab.frequencyPerDay }}x/day · max {{ ab.maxMgPerDay }} mg/day</div>
        <div class="muted small">Source: {{ ab.source }}</div>
        <!-- A derived volume must never read as coming from the source line above it. -->
        <div class="muted small" *ngIf="ab.doseMlSource === 'derived'">
          mL from the selected bottle's concentration
        </div>
        <button type="button" class="secondary small" (click)="useAgeBand.emit()">Use this</button>
      </div>
      <p class="muted small" *ngIf="result && !result.guidance.weightBased && !result.guidance.ageBand">
        No applicable dosing guidance found for this medication{{ hasEmbodiments ? '/embodiment' : '' }} yet.
      </p>
    </div>
  `,
  styles: [
    `
      .guidance-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
      }
      .guidance-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
      }
      .guidance-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .guidance-amount {
        font-size: 1.3rem;
        font-weight: 700;
      }
    `,
  ],
})
export class DoseGuidanceComponent {
  @Input() result: DoseCheckResult | null = null;
  /** Whether the medication has embodiments — only changes the "no guidance" sentence. */
  @Input() hasEmbodiments = false;
  @Output() useWeightBased = new EventEmitter<void>();
  @Output() useAgeBand = new EventEmitter<void>();
}
