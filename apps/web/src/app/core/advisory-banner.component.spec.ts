import { TestBed } from '@angular/core/testing';
import { AdvisoryBannerComponent } from './advisory-banner.component';

describe('AdvisoryBannerComponent', () => {
  async function render(advisory: any) {
    await TestBed.configureTestingModule({ imports: [AdvisoryBannerComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AdvisoryBannerComponent);
    fixture.componentInstance.advisory = advisory;
    fixture.detectChanges();
    return fixture;
  }

  it('renders atypical_dose reasons in the title', async () => {
    const fixture = await render({
      type: 'atypical_dose',
      severity: 'warning',
      payload: { reasons: ['exceeds_max_per_dose', 'interval_too_short'], amountMg: 500, dailyTotalMg: 900 },
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('exceeds max per dose');
    expect(text).toContain('too soon since the last dose');
    expect(text).toContain('900');
  });

  it('renders stale_weight with days-since detail', async () => {
    const fixture = await render({
      type: 'stale_weight',
      severity: 'warning',
      payload: { daysSince: 75, lastRecordedAt: 1700000000 },
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('75 days old');
    expect(text).toContain('fresh weight');
  });

  it('renders "no weight on file" when daysSince is null', async () => {
    const fixture = await render({
      type: 'stale_weight',
      severity: 'warning',
      payload: { daysSince: null, lastRecordedAt: null },
    });
    expect(fixture.nativeElement.textContent).toContain('No weight on file');
  });

  it('renders reaction_danger with the recorded description as detail', async () => {
    const fixture = await render({
      type: 'reaction_danger',
      severity: 'danger',
      payload: { description: 'throat swelled up', occurredAt: 1700000000 },
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Dangerous adverse reaction on file');
    expect(text).toContain('throat swelled up');
  });

  it('renders protocol_fired with the instruction text as detail', async () => {
    const fixture = await render({
      type: 'protocol_fired',
      severity: 'danger',
      payload: { instructionText: 'ER immediately, do not give antipyretics first' },
    });
    expect(fixture.nativeElement.textContent).toContain('ER immediately, do not give antipyretics first');
  });

  it('applies the severity class for styling', async () => {
    const fixture = await render({ type: 'protocol_fired', severity: 'danger', payload: {} });
    const el = fixture.nativeElement.querySelector('.advisory');
    expect(el.classList).toContain('severity-danger');
  });
});
