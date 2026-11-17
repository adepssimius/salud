import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InfoTipComponent } from './info-tip.component';

@Component({
  standalone: true,
  imports: [InfoTipComponent],
  template: `<app-info-tip label="Why?">Because.</app-info-tip><p class="outside">elsewhere</p>`,
})
class HostComponent {}

describe('InfoTipComponent', () => {
  const build = () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, button: el.querySelector('button') as HTMLButtonElement, text: el.querySelector('.info-tip-text') as HTMLElement };
  };

  it('is closed by default and named for assistive tech', () => {
    const { button, text } = build();
    expect(text.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Why?');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(text.textContent).toContain('Because.');
  });

  it('toggles on tap, and closes on a tap elsewhere or Escape', () => {
    const { fixture, el, button, text } = build();
    button.click();
    fixture.detectChanges();
    expect(text.classList.contains('open')).toBe(true);
    (el.querySelector('.outside') as HTMLElement).click();
    fixture.detectChanges();
    expect(text.classList.contains('open')).toBe(false);
    button.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(text.classList.contains('open')).toBe(false);
  });
});
