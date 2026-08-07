import { TestBed } from '@angular/core/testing';
import { DangerInterstitialComponent } from './danger-interstitial.component';

describe('DangerInterstitialComponent', () => {
  async function render(advisories: any[]) {
    await TestBed.configureTestingModule({ imports: [DangerInterstitialComponent] }).compileComponents();
    const fixture = TestBed.createComponent(DangerInterstitialComponent);
    fixture.componentInstance.advisories = advisories;
    fixture.detectChanges();
    return fixture;
  }

  it('renders each reaction description', async () => {
    const fixture = await render([
      { type: 'reaction_danger', severity: 'danger', payload: { description: 'throat swelled up' } },
    ]);
    expect(fixture.nativeElement.textContent).toContain('throat swelled up');
  });

  it('emits proceed when the confirm button is clicked', async () => {
    const fixture = await render([{ type: 'reaction_danger', severity: 'danger', payload: {} }]);
    const spy = jest.fn();
    fixture.componentInstance.proceed.subscribe(spy);
    fixture.nativeElement.querySelector('.proceed').click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits backOut when backing out', async () => {
    const fixture = await render([{ type: 'reaction_danger', severity: 'danger', payload: {} }]);
    const spy = jest.fn();
    fixture.componentInstance.backOut.subscribe(spy);
    fixture.nativeElement.querySelector('.secondary').click();
    expect(spy).toHaveBeenCalled();
  });
});
