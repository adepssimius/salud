import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MedicationTypeaheadComponent } from './medication-typeahead.component';
import { ApiClientService } from './api-client.service';

const AMOX = {
  id: 'm1',
  name: 'amoxicillin',
  brandNames: ['Amoxil'],
  description: null,
  tags: ['penicillin'],
  defaultActive: true,
  createdAt: 0,
  updatedAt: 0,
};

describe('MedicationTypeaheadComponent', () => {
  let apiMock: any;

  beforeEach(async () => {
    apiMock = { get: jest.fn().mockReturnValue(of([AMOX])) };
    await TestBed.configureTestingModule({
      imports: [MedicationTypeaheadComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  function build() {
    const fixture = TestBed.createComponent(MedicationTypeaheadComponent);
    fixture.detectChanges();
    return fixture;
  }

  function type(fixture: any, value: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('searches the catalog and lists brand names alongside the generic', () => {
    const fixture = build();
    type(fixture, 'amox');

    expect(apiMock.get).toHaveBeenCalledWith('/medications', { q: 'amox' });
    expect(fixture.nativeElement.textContent).toContain('amoxicillin');
    // Brand names are how a caregiver holding the box knows they found the right row.
    expect(fixture.nativeElement.textContent).toContain('Amoxil');
  });

  it('emits the choice rather than owning it, and drops the query behind it', () => {
    const fixture = build();
    const emitted: any[] = [];
    fixture.componentInstance.selectedChange.subscribe((m: any) => emitted.push(m));

    type(fixture, 'amox');
    fixture.nativeElement.querySelector('.med-result').click();

    // The host owns the selection so it can clear it when its own form resets; the component only
    // reports the choice.
    expect(emitted).toEqual([AMOX]);
    expect(fixture.componentInstance.query()).toBe('');
    expect(fixture.componentInstance.results().length).toBe(0);
  });

  it('shows the chosen medication with a way back to the search', () => {
    const fixture = build();
    fixture.componentInstance.selected = AMOX as any;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.chosen-med').textContent).toContain('amoxicillin');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();

    const emitted: any[] = [];
    fixture.componentInstance.selectedChange.subscribe((m: any) => emitted.push(m));
    fixture.nativeElement.querySelector('.chosen-med .link').click();
    expect(emitted).toEqual([null]);
  });

  it('clears the results when the query is emptied, without asking the API for everything', () => {
    const fixture = build();
    type(fixture, 'amox');
    expect(fixture.componentInstance.results().length).toBe(1);

    apiMock.get.mockClear();
    type(fixture, '');

    expect(apiMock.get).not.toHaveBeenCalled();
    expect(fixture.componentInstance.results().length).toBe(0);
  });

  it('shows no results rather than an error when the search fails', () => {
    apiMock.get.mockReturnValue(throwError(() => ({ status: 500 })));
    const fixture = build();

    // The next keystroke retries anyway; an error line here would outlive the query that caused it.
    expect(() => type(fixture, 'amox')).not.toThrow();
    expect(fixture.componentInstance.results().length).toBe(0);
  });
});
