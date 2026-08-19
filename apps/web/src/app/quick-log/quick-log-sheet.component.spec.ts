import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { QuickLogSheetComponent } from './quick-log-sheet.component';
import { ApiClientService } from '../core/api-client.service';

const PATIENTS = [
  { id: 'p1', fullName: 'Ada' },
  { id: 'p2', fullName: 'Zoe' },
];

const RECENT = {
  medicationId: 'med-1',
  medicationName: 'Acetaminophen',
  lastDoseAt: Math.floor(Date.now() / 1000) - 3 * 3600,
  lastAmountMg: 160,
  lastAmountMl: 5,
  lastEmbodimentId: 'emb-1',
  lastEmbodimentLabel: 'infant suspension 160mg/5mL',
  nextAllowedAt: Math.floor(Date.now() / 1000) + 3600,
  isAtypicalLastDose: false,
  onActiveSchedule: false,
};

const SCHEDULED_ONLY = {
  ...RECENT,
  medicationId: 'med-2',
  medicationName: 'Amoxicillin',
  lastDoseAt: null,
  lastAmountMg: null,
  lastAmountMl: null,
  lastEmbodimentId: null,
  lastEmbodimentLabel: null,
  nextAllowedAt: null,
  onActiveSchedule: true,
};

describe('QuickLogSheetComponent', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = { get: jest.fn() };
    routerMock = { navigate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [QuickLogSheetComponent],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  function render(patients: any[] = PATIENTS, lockedPatientId: string | null = null, recents: any[] = [RECENT]) {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/patients') return of(patients);
      if (path === '/dashboard') return of({ activeEpisodes: [], lastDoses: [] });
      if (path.includes('recent-medications')) return of(recents);
      return of([]);
    });
    const fixture = TestBed.createComponent(QuickLogSheetComponent);
    fixture.componentRef.setInput('lockedPatientId', lockedPatientId);
    fixture.detectChanges();
    return fixture;
  }

  describe('patient scoping', () => {
    it('skips the question entirely for a single-patient household', () => {
      const fixture = render([PATIENTS[0]]);
      expect(fixture.componentInstance.step()).toBe('verb');
      expect(fixture.componentInstance.patientId()).toBe('p1');
    });

    it('asks first when the household has more than one patient', () => {
      const fixture = render();
      expect(fixture.componentInstance.step()).toBe('patient');
      expect(apiMock.get).toHaveBeenCalledWith('/dashboard');
    });

    it('is pre-scoped inside a patient hub', () => {
      const fixture = render(PATIENTS, 'p2');
      expect(fixture.componentInstance.step()).toBe('verb');
      expect(fixture.componentInstance.patientId()).toBe('p2');
      // No wasted dashboard fetch: nothing needs ordering when there is no choice to make.
      expect(apiMock.get).not.toHaveBeenCalledWith('/dashboard');
    });

    it('pins the chosen patient at the top of the sheet', () => {
      const fixture = render();
      fixture.componentInstance.choosePatient('p2');
      fixture.detectChanges();
      const pinned = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="quick-log-patient"]');
      expect(pinned?.textContent).toContain('Zoe');
    });

    // Sick-first: an active episode outranks a quiet patient, then the most recent event.
    it('orders the chips sick-first, then by most recent event', () => {
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/patients') return of([...PATIENTS, { id: 'p3', fullName: 'Bo' }]);
        if (path === '/dashboard')
          return of({
            activeEpisodes: [{ patientId: 'p2', lastObservationSummary: null, medications: [] }],
            lastDoses: [{ patientId: 'p3', doses: [{ lastDoseAt: 99999 }] }],
          });
        return of([]);
      });
      const fixture = TestBed.createComponent(QuickLogSheetComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.orderedPatients().map((p: any) => p.id)).toEqual(['p2', 'p3', 'p1']);
    });

    it('falls back to name order when the dashboard is unreachable', () => {
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/patients') return of(PATIENTS);
        if (path === '/dashboard') return throwError(() => ({ status: 500 }));
        return of([]);
      });
      const fixture = TestBed.createComponent(QuickLogSheetComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.orderedPatients().map((p: any) => p.id)).toEqual(['p1', 'p2']);
    });
  });

  describe('verbs', () => {
    it('offers verbs, never entity names', () => {
      const fixture = render([PATIENTS[0]]);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Temp');
      expect(text).toContain('Dose');
      expect(text).toContain('Pain');
      expect(text).toContain('Note');
      expect(text).toContain('Photo');
      expect(text.toLowerCase()).not.toContain('intervention');
      expect(text.toLowerCase()).not.toContain('embodiment');
      // "Full observation…" is the one deliberate exception — it names the composer, not a verb.
      expect(text).toContain('Full observation');
    });

    it('lands Temp in the existing observation form with the type pre-selected', () => {
      const fixture = render([PATIENTS[0]]);
      const temp: HTMLButtonElement = fixture.nativeElement.querySelector('[data-verb="temperature"]');
      temp.click();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/observations/new'], {
        queryParams: { patientId: 'p1', entryType: 'temperature', compact: '1' },
      });
    });

    it('sends "Full observation…" to the unrestricted multi-entry composer', () => {
      const fixture = render([PATIENTS[0]]);
      fixture.componentInstance.fullObservation();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/observations/new'], {
        queryParams: { patientId: 'p1' },
      });
    });
  });

  describe('dose — recents first, search second', () => {
    it('leads with recents for the selected patient only', () => {
      const fixture = render([PATIENTS[0]]);
      fixture.componentInstance.chooseVerb('dose');
      fixture.detectChanges();

      expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/recent-medications');
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Acetaminophen');
      expect(text).toContain('160 mg');
      expect(text).toContain('infant suspension 160mg/5mL');
      expect(text).toContain('ago');
      expect(text).toContain('next dose in');
    });

    it('prefills medication, embodiment and amount from the tapped card', () => {
      const fixture = render([PATIENTS[0]]);
      fixture.componentInstance.chooseRecent(RECENT as any);
      expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions/new'], {
        queryParams: {
          patientId: 'p1',
          type: 'medication_dose',
          compact: '1',
          medicationId: 'med-1',
          embodimentId: 'emb-1',
          amountMg: '160',
          amountMl: '5',
        },
      });
    });

    it('carries no prefill for a scheduled medication never yet given', () => {
      const fixture = render([PATIENTS[0]], null, [SCHEDULED_ONLY]);
      fixture.componentInstance.chooseRecent(SCHEDULED_ONLY as any);
      expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions/new'], {
        queryParams: { patientId: 'p1', type: 'medication_dose', compact: '1', medicationId: 'med-2' },
      });
    });

    it('says "never given" rather than leaving the line blank', () => {
      const fixture = render([PATIENTS[0]], null, [SCHEDULED_ONLY]);
      fixture.componentInstance.chooseVerb('dose');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('never given');
    });

    it('keeps the typeahead reachable for anything new', () => {
      const fixture = render([PATIENTS[0]]);
      fixture.componentInstance.searchInstead();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions/new'], {
        queryParams: { patientId: 'p1', type: 'medication_dose', compact: '1' },
      });
    });
  });

  it('closes itself as it hands off, so the sheet is gone when the form arrives', () => {
    const fixture = render([PATIENTS[0]]);
    const dismissed = jest.fn();
    fixture.componentInstance.dismiss.subscribe(dismissed);
    fixture.componentInstance.chooseVerb('note');
    expect(dismissed).toHaveBeenCalled();
  });
});
