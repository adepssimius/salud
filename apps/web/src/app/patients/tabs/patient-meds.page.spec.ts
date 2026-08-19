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
