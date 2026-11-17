import { Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';

/**
 * A small ⓘ that explains a field without putting the explanation on the page by default.
 * Hover or keyboard focus shows it on a desktop; a tap toggles it on a phone, where there is no
 * hover. Escape or a tap elsewhere closes it. The text is projected content.
 */
@Component({
  selector: 'app-info-tip',
  standalone: true,
  template: `
    <button
      type="button"
      class="info-tip-button"
      [attr.aria-label]="label"
      [attr.aria-expanded]="open()"
      (click)="toggle($event)"
    >
      ⓘ
    </button>
    <span class="info-tip-text" role="tooltip" [class.open]="open()"><ng-content></ng-content></span>
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .info-tip-button {
        background: none;
        border: none;
        padding: 0 0.15rem;
        color: var(--accent-soft);
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
      }
      .info-tip-text {
        display: none;
        position: absolute;
        z-index: 20;
        top: calc(100% + 0.35rem);
        left: 50%;
        transform: translateX(-50%);
        width: min(18rem, calc(100vw - 2rem));
        padding: 0.6rem 0.7rem;
        border-radius: var(--radius-input);
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        color: var(--text);
        font-size: 0.85rem;
        font-weight: 400;
        line-height: 1.35;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
      }
      .info-tip-text.open,
      :host(:hover) .info-tip-text,
      :host(:focus-within) .info-tip-text {
        display: block;
      }
      @media (max-width: 480px) {
        /* On a phone the tip anchors to the left edge of its icon so it stays on screen. */
        .info-tip-text {
          left: auto;
          right: -0.5rem;
          transform: none;
        }
      }
    `,
  ],
})
export class InfoTipComponent {
  /** The button's accessible name, e.g. "What does strict mean?". */
  @Input() label = 'More information';
  private readonly host = inject(ElementRef<HTMLElement>);
  open = signal(false);

  toggle(event: Event) {
    event.preventDefault();
    this.open.set(!this.open());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(false);
  }
}
