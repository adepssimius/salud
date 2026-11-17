import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { PillCountInputComponent } from './pill-count-input.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, PillCountInputComponent],
  template: `<app-pill-count-input [formControl]="pills" />`,
})
class HostComponent {
  pills = new FormControl<number | null>(null);
}

describe('PillCountInputComponent', () => {
  function render(initial: number | null = null) {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.pills.setValue(initial);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host: fixture.componentInstance,
      whole: el.querySelector('input') as HTMLInputElement,
      fraction: el.querySelector('select') as HTMLSelectElement,
    };
  }

  it('offers ¼, ⅓, ½, ⅔ and ¾', () => {
    const { fraction } = render();
    expect(Array.from(fraction.options).map((o) => o.textContent?.trim())).toEqual([
      '+ none',
      '+ ¼',
      '+ ⅓',
      '+ ½',
      '+ ⅔',
      '+ ¾',
    ]);
  });

  it('emits whole + fraction as one number', () => {
    const { whole, fraction, host } = render();
    whole.value = '1';
    whole.dispatchEvent(new Event('input'));
    expect(host.pills.value).toBe(1);
    fraction.value = String(1 / 3);
    fraction.dispatchEvent(new Event('change'));
    expect(host.pills.value).toBeCloseTo(4 / 3, 10);
  });

  it('a fraction alone is a partial pill, and clearing both is null', () => {
    const { whole, fraction, host } = render();
    fraction.value = '0.5';
    fraction.dispatchEvent(new Event('change'));
    expect(host.pills.value).toBe(0.5);
    fraction.value = '0';
    fraction.dispatchEvent(new Event('change'));
    whole.value = '';
    whole.dispatchEvent(new Event('input'));
    expect(host.pills.value).toBeNull();
  });

  it('shows a stored 2⅔ split back into its parts', () => {
    const { whole, fixture } = render(2 + 2 / 3);
    const comp = fixture.debugElement.children[0].componentInstance as PillCountInputComponent;
    expect(whole.value).toBe('2');
    expect(comp.fraction()).toBeCloseTo(2 / 3, 10);
  });

  it('shows ½ with an empty whole box rather than "0"', () => {
    const { whole } = render(0.5);
    expect(whole.value).toBe('');
  });
});
