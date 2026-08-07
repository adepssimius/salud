import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MedicationDetailPage } from './medication-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('MedicationDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.includes('/embodiments') || path.includes('/guidelines')) return of([]);
        return of({
          id: 'm1',
          name: 'acetaminophen',
          brandNames: [],
          description: null,
          tags: [],
          defaultActive: true,
          createdAt: 0,
          updatedAt: 0,
        });
      }),
      post: jest.fn(),
      patch: jest.fn(),
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
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/embodiments')) {
        return of([
          {
            id: 'e1',
            medicationId: 'm1',
            label: '500mg tablet',
            concentrationMgPerMl: null,
            strengthMgPerUnit: 500,
            unitType: 'tablet',
            notes: null,
            atHome: false,
            expiresAt: null,
            runningLow: false,
            runningLowFlaggedByUserId: null,
            runningLowFlaggedAt: null,
          },
        ]);
      }
      if (path.includes('/guidelines')) {
        return of([]);
      }
      return of({ id: 'm1', name: 'acetaminophen', brandNames: [], description: null, tags: [], defaultActive: true, createdAt: 0, updatedAt: 0 });
    });

    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.medication()?.name).toBe('acetaminophen');
    expect(comp.embodiments().length).toBe(1);
  });

  it('toggles runningLow via PATCH and reloads', () => {
    apiMock.patch.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const embodiment = {
      id: 'e1',
      medicationId: 'm1',
      label: 'x',
      concentrationMgPerMl: null,
      strengthMgPerUnit: null,
      unitType: 'tablet' as const,
      notes: null,
      atHome: false,
      expiresAt: null,
      runningLow: false,
      runningLowFlaggedByUserId: null,
      runningLowFlaggedAt: null,
    };
    comp.toggleRunningLow(embodiment, { target: { checked: true } } as unknown as Event);
    expect(apiMock.patch).toHaveBeenCalledWith('/embodiments/e1', { runningLow: true });
  });

  it('creates an embodiment from the form', () => {
    apiMock.post.mockReturnValue(of({ id: 'e2' }));
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.embodimentForm.setValue({
      label: '5mL syrup',
      unitType: 'ml',
      concentrationMgPerMl: 32,
      strengthMgPerUnit: null,
    });
    comp.createEmbodiment();
    expect(apiMock.post).toHaveBeenCalledWith('/medications/m1/embodiments', {
      label: '5mL syrup',
      unitType: 'ml',
      concentrationMgPerMl: 32,
      strengthMgPerUnit: undefined,
    });
  });

  it('navigates back to the medications list', () => {
    const fixture = TestBed.createComponent(MedicationDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.backToList();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/medications']);
  });
});
