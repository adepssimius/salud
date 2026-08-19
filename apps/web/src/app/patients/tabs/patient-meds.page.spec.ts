import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { PatientMedsPage } from './patient-meds.page';
import { PatientHubStore } from '../patient-hub.store';
import { ApiClientService } from '../../core/api-client.service';

describe('PatientMedsPage', () => {
  let apiMock: any;
  let routerMock: any;
  let store: PatientHubStore;

  const build = (reactions: any[] = []) => {
    store = TestBed.inject(PatientHubStore);
    store.patientId.set('p1');
    store.reactions.set(reactions as any);
    const fixture = TestBed.createComponent(PatientMedsPage);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path === '/patients/p1/schedules') return of([{ id: 's1', label: 'Amoxicillin q8h', status: 'active' }]);
        if (path === '/medications') return of([{ id: 'm1', name: 'Amoxicillin' }]);
        if (path === '/medications/m1/embodiments')
          return of([
            {
              id: 'e1',
              medicationId: 'm1',
              label: 'suspension',
              concentrationMgPerMl: 50,
              concentrationMg: 250,
              concentrationVolumeMl: 5,
            },
          ]);
        return of([]);
      }),
      delete: jest.fn(),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientMedsPage],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('lists this patient schedules', () => {
    const fixture = build();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/schedules');
    expect(fixture.nativeElement.textContent).toContain('Amoxicillin q8h');
  });

  it('renders reactions from the hub store and names the medication scope', () => {
    const fixture = build([
      { id: 'r1', severity: 'danger', description: 'throat swelling', scopeType: 'medication', medicationId: 'm1', occurredAt: null },
    ]);
    // One catalog fetch resolves every medication-scoped row rather than one lookup per row.
    expect(apiMock.get).toHaveBeenCalledWith('/medications');
    expect(fixture.componentInstance.describeReactionScope({ scopeType: 'medication', medicationId: 'm1' } as any)).toBe(
      'Amoxicillin',
    );
    expect(fixture.nativeElement.textContent).toContain('Date unknown');
  });

  it('skips the catalog fetch when there are no reactions to name', () => {
    build([]);
    expect(apiMock.get).not.toHaveBeenCalledWith('/medications');
  });

  it('removing a reaction updates the store so the header pills drop it too', () => {
    apiMock.delete.mockReturnValue(of({ deleted: true }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = build([{ id: 'r1', severity: 'danger', description: 'hives', scopeType: 'tag', tag: 'penicillin' }]);
    fixture.componentInstance.deleteReaction({ id: 'r1', description: 'hives' } as any);
    expect(apiMock.delete).toHaveBeenCalledWith('/patients/p1/reactions/r1');
    expect(store.reactions().length).toBe(0);
  });

  it('says so when a reaction cannot be removed', () => {
    apiMock.delete.mockReturnValue(throwError(() => ({ error: { message: 'boom' } })));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = build([{ id: 'r1', severity: 'warning', description: 'hives', scopeType: 'tag', tag: 'x' }]);
    fixture.componentInstance.deleteReaction({ id: 'r1', description: 'hives' } as any);
    expect(fixture.componentInstance.reactionsError()).toBe('Could not remove the reaction.');
    expect(store.reactions().length).toBe(1);
  });

  it('resolves scope names when the reactions arrive after the tab has rendered', () => {
    // The real hub store fetches reactions over HTTP, so the list is empty at ngOnInit. Resolving
    // names only at construction left every medication-scoped row saying "a medication" forever.
    const fixture = build([]);
    expect(apiMock.get).not.toHaveBeenCalledWith('/medications');

    store.reactions.set([
      { id: 'r1', severity: 'warning', description: 'rash', scopeType: 'medication', medicationId: 'm1', occurredAt: null },
    ] as any);
    fixture.detectChanges();

    expect(apiMock.get).toHaveBeenCalledWith('/medications');
    expect(fixture.nativeElement.textContent).toContain('Amoxicillin');
  });

  it('names the exact form for an embodiment-scoped reaction', () => {
    const fixture = build([
      { id: 'r1', severity: 'danger', description: 'hives', scopeType: 'embodiment', embodimentId: 'e1', occurredAt: null },
    ]);

    // A reaction to one bottle is not a reaction to the drug: the row has to say which form, in
    // the bottle's own words (frontend.md -> Reactions -> List row).
    expect(apiMock.get).toHaveBeenCalledWith('/medications/m1/embodiments');
    expect(fixture.componentInstance.describeReactionScope({ scopeType: 'embodiment', embodimentId: 'e1' } as any)).toBe(
      'Amoxicillin — 250 mg / 5 mL (50 mg/mL) suspension',
    );
  });

  it('does not repeat the strength when the form label already carries it', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of([{ id: 'm1', name: 'acetaminophen' }]);
      if (path === '/medications/m1/embodiments')
        return of([
          {
            id: 'e1',
            medicationId: 'm1',
            label: "160 mg/5 mL suspension (Children's Tylenol)",
            concentrationMgPerMl: 32,
            concentrationMg: 160,
            concentrationVolumeMl: 5,
          },
        ]);
      return of([]);
    });
    const fixture = build([
      { id: 'r1', severity: 'warning', description: 'blistered', scopeType: 'embodiment', embodimentId: 'e1', occurredAt: null },
    ]);

    // Prefixing the derived figure onto a label that is already the strength as printed read
    // "acetaminophen — 160 mg / 5 mL (32 mg/mL) 160 mg/5 mL suspension" on real seeded data.
    expect(fixture.componentInstance.describeReactionScope({ scopeType: 'embodiment', embodimentId: 'e1' } as any)).toBe(
      "acetaminophen — 160 mg/5 mL suspension (Children's Tylenol)",
    );
  });

  it('does not fan out over embodiments when no reaction is scoped to one', () => {
    build([
      { id: 'r1', severity: 'warning', description: 'rash', scopeType: 'tag', tag: 'penicillin', occurredAt: null },
    ]);
    expect(apiMock.get).not.toHaveBeenCalledWith('/medications/m1/embodiments');
  });

  it('attributes a reaction to the caregiver who recorded it', () => {
    const fixture = build([
      {
        id: 'r1',
        severity: 'warning',
        description: 'rash',
        scopeType: 'tag',
        tag: 'penicillin',
        occurredAt: null,
        recordedByUserId: 'u1',
      },
    ]);
    store.careTeam.set([{ user: { id: 'u1', email: 'sam@example.com', displayName: 'Sam' }, role: 'parent' }] as any);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('recorded by Sam');
  });

  it('drops the attribution rather than showing a raw id when the recorder has left the care team', () => {
    const fixture = build([
      { id: 'r1', severity: 'warning', description: 'rash', scopeType: 'tag', tag: 'x', occurredAt: null, recordedByUserId: 'gone' },
    ]);
    store.careTeam.set([{ user: { id: 'u1', email: 'sam@example.com', displayName: 'Sam' }, role: 'parent' }] as any);
    fixture.detectChanges();

    expect(fixture.componentInstance.recordedBy({ recordedByUserId: 'gone' } as any)).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('recorded by');
  });

  it('says how to correct a reaction, since there is no edit', () => {
    // No PATCH exists (ISSUES.md #30); a caregiver who spots a typo needs telling what to do.
    const fixture = build([
      { id: 'r1', severity: 'warning', description: 'rash', scopeType: 'tag', tag: 'x', occurredAt: null },
    ]);
    expect(fixture.nativeElement.textContent).toContain('remove it and record it again');
    expect(fixture.nativeElement.textContent).not.toContain('Edit');
  });

  it('routes to the reaction and schedule entry points', () => {
    const fixture = build();
    const component = fixture.componentInstance;
    component.goToNewReaction();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'reactions', 'new']);
    component.goToNewSchedule();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules/new'], { queryParams: { patientId: 'p1' } });
    component.goToSchedule('s1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules', 's1']);
  });
});
