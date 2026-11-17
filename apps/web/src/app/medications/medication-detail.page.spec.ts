import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MedicationDetailPage } from './medication-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const MED = {
  id: 'm1',
  name: 'acetaminophen',
  brandNames: [],
  description: null,
  tags: [],
  defaultActive: true,
  createdAt: 0,
  updatedAt: 0,
};

const EMB = {
  id: 'e1',
  medicationId: 'm1',
  label: '500mg tablet',
  concentrationMgPerMl: null,
  concentrationMg: null,
  concentrationVolumeMl: null,
  strengthMgPerUnit: 500,
  unitType: 'tablet' as const,
  dosageForm: 'tablet' as const,
  notes: null,
  atHome: false,
  expiresAt: null,
  runningLow: false,
  runningLowFlaggedByUserId: null,
  runningLowFlaggedAt: null,
};

const GUIDE = {
  id: 'g1',
  medicationId: 'm1',
  medicationEmbodimentId: null,
  source: 'AAP',
  type: 'weight_based' as const,
  mgPerKg: 15,
  maxMgPerDose: 1000,
  maxMgPerDay: 4000,
  minIntervalHours: 4,
  ageMinMonths: null,
  ageMaxMonths: null,
  doseMg: null,
  doseMl: null,
  pillCount: null,
  frequencyPerDay: null,
  notes: null,
};

describe('MedicationDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  function withRows(embodiments: any[] = [EMB], guidelines: any[] = [GUIDE], med: any = MED) {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments')) return of(embodiments);
      if (path.includes('/guidelines')) return of(guidelines);
      return of(med);
    });
  }

  function build() {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    return fixture;
  }

  function buttons(fixture: any, text: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(
      (b) => b.textContent?.trim() === text,
    );
  }

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.includes('/embodiments') || path.includes('/guidelines')) return of([]);
        return of(MED);
      }),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [MedicationDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'm1']]) } },
        },
      ],
    }).compileComponents();
  });

  it('loads medication, embodiments, and guidelines on init', () => {
    withRows();
    const comp = build().componentInstance;

    expect(comp.medication()?.name).toBe('acetaminophen');
    expect(comp.embodiments().length).toBe(1);
    expect(comp.guidelines().length).toBe(1);
  });

  // Two controls hidden behind a condition that held in the common case shipped broken the same
  // week this editor was written. Every Edit here depends only on the page having loaded.
  it('shows an Edit control on the header, every embodiment and every guideline', () => {
    withRows([EMB, { ...EMB, id: 'e2', label: 'syrup' }], [GUIDE]);
    const fixture = build();

    expect(buttons(fixture, 'Edit').length).toBe(4);
  });

  it('still offers Edit on the header of an inactive medication with nothing under it', () => {
    withRows([], [], { ...MED, defaultActive: false });
    const fixture = build();

    expect(buttons(fixture, 'Edit').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Inactive');
  });

  it('opens the header editor in place of the header', () => {
    withRows();
    const fixture = build();

    buttons(fixture, 'Edit')[0].click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-medication-header-editor')).not.toBeNull();
  });

  it('opens one embodiment editor at a time, in place of its row', () => {
    withRows([EMB, { ...EMB, id: 'e2', label: 'syrup' }], []);
    const fixture = build();
    const comp = fixture.componentInstance;

    comp.editEmbodiment('e1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-embodiment-editor').length).toBe(1);

    comp.addEmbodiment();
    fixture.detectChanges();
    expect(comp.editingEmbodimentId()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('app-embodiment-editor').length).toBe(1);
  });

  it('closes the editors and reloads after a catalog change', () => {
    withRows();
    const comp = build().componentInstance;
    comp.editGuideline('g1');
    apiMock.get.mockClear();

    comp.onCatalogChanged();

    expect(comp.editingGuidelineId()).toBeNull();
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1');
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1/embodiments');
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1/guidelines');
  });

  it('goes back to the list after the medication is deleted', () => {
    withRows();
    const fixture = build();
    fixture.componentInstance.editingHeader.set(true);
    fixture.detectChanges();

    jest.spyOn(window, 'confirm').mockReturnValue(true);
    apiMock.delete.mockReturnValue(of(undefined));
    buttons(fixture, 'Delete medication')[0].click();

    expect(apiMock.delete).toHaveBeenCalledWith('/medications/m1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/medications']);
  });

  it('toggles runningLow via PATCH', () => {
    apiMock.patch.mockReturnValue(of({ ...EMB, runningLow: true }));
    const comp = build().componentInstance;

    comp.toggleRunningLow(EMB, { target: { checked: true } } as unknown as Event);
    expect(apiMock.patch).toHaveBeenCalledWith('/embodiments/e1', { runningLow: true });
  });

  it('navigates back to the medications list', () => {
    const comp = build().componentInstance;
    comp.backToList();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/medications']);
  });

  it('shows an error instead of a blank page when the medication fails to load', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments') || path.includes('/guidelines')) return of([]);
      return throwError(() => ({ status: 500, error: { message: 'boom' } }));
    });

    const fixture = build();
    const comp = fixture.componentInstance;

    expect(comp.medication()).toBeNull();
    expect(comp.loadError()).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Loading…');
  });

  it('rolls the checkbox back and says so when the cabinet PATCH fails', () => {
    withRows([{ ...EMB, label: 'x' }], []);
    apiMock.patch.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'boom' } })));

    const comp = build().componentInstance;
    comp.toggleRunningLow(comp.embodiments()[0], { target: { checked: true } } as unknown as Event);

    // A failed PATCH used to leave the box checked while the server disagreed -- on runningLow
    // that means the shopping list silently disagrees with the screen.
    expect(comp.embodiments()[0].runningLow).toBe(false);
    expect(comp.cabinetError()).toBeTruthy();
  });
});
