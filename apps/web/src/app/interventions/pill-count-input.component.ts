import { Component, forwardRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { PILL_FRACTIONS, splitPillCount } from '@salud/shared/types';

/**
 * A pill count as a whole number plus a fraction — none, ¼, ⅓, ½, ⅔, ¾ (frontend.md → "Dose
 * entry" → "Partial pills"). The control's value stays one number (⅓ is 0.3333…), so the form,
 * the request body and the API are unchanged; only the input is split.
 *
 * A stored count that is not a whole plus an offered fraction (an old 0.4) is shown as typed in the
 * number box with no fraction, rather than snapped to one it isn't.
 */
@Component({
  selector: 'app-pill-count-input',
  standalone: true,
  imports: [CommonModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PillCountInputComponent), multi: true }],
  template: `
    <div class="pill-count">
      <input
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        aria-label="Whole pills"
        [value]="whole() ?? ''"
        [disabled]="disabled()"
        (input)="onWhole($event)"
        (blur)="touched()"
      />
      <select aria-label="Part of a pill" [disabled]="disabled()" (change)="onFraction($event)" (blur)="touched()">
        <option value="0" [selected]="fraction() === 0">+ none</option>
        <option *ngFor="let f of fractions" [value]="f.value" [selected]="fraction() === f.value">+ {{ f.label }}</option>
      </select>
    </div>
  `,
  styles: [
    `
      .pill-count {
        display: flex;
        gap: 0.5rem;
      }
      .pill-count input {
        flex: 1 1 4rem;
        min-width: 0;
      }
      .pill-count select {
        flex: 0 0 auto;
        width: auto;
      }
    `,
  ],
})
export class PillCountInputComponent implements ControlValueAccessor {
  readonly fractions = PILL_FRACTIONS;
  whole = signal<number | null>(null);
  fraction = signal(0);
  disabled = signal(false);

  private onChange: (value: number | null) => void = () => undefined;
  touched: () => void = () => undefined;

  writeValue(value: number | null): void {
    if (value == null || !Number.isFinite(value)) {
      this.whole.set(null);
      this.fraction.set(0);
      return;
    }
    const split = splitPillCount(value);
    if (split) {
      // "½" reads as no whole pills and a half, not "0 + ½".
      this.whole.set(split.whole || split.fraction === 0 ? split.whole : null);
      this.fraction.set(split.fraction);
    } else {
      this.whole.set(value);
      this.fraction.set(0);
    }
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  onWhole(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.whole.set(raw === '' ? null : Number(raw));
    this.emit();
  }

  onFraction(event: Event): void {
    this.fraction.set(Number((event.target as HTMLSelectElement).value));
    this.emit();
  }

  private emit(): void {
    const whole = this.whole();
    const fraction = this.fraction();
    if (whole == null && fraction === 0) {
      this.onChange(null);
      return;
    }
    this.onChange((whole ?? 0) + fraction);
  }
}
