import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PatientHubStore } from './patient-hub.store';
import { ApiClientService } from '../core/api-client.service';

/**
 * The store outlives any one patient: it is route-scoped, and Angular builds a route's injector
 * once, so the hub for B gets the instance that last held A (frontend.md → "Patient identity").
 */
describe('PatientHubStore', () => {
  let store: PatientHubStore;
  let responses: Record<string, Subject<any>>;

  beforeEach(() => {
    responses = {};
    TestBed.configureTestingModule({
      providers: [
        PatientHubStore,
        {
          provide: ApiClientService,
          useValue: { get: jest.fn((path: string) => (responses[path] ??= new Subject<any>())) },
        },
      ],
    });
    store = TestBed.inject(PatientHubStore);
  });

  it('drops everything held for the previous patient as soon as a new one is loaded', () => {
    store.load('a');
    responses['/patients/a'].next({ id: 'a', fullName: 'A' });
    responses['/patients/a/reactions'].next([{ id: 'r1', severity: 'danger' }]);
    responses['/patients/a/episodes'].next([{ id: 'e1' }]);
    responses['/patients/a/care-team'].next([{ user: { id: 'u1' } }]);

    store.load('b');
    expect(store.patientId()).toBe('b');
    expect(store.patient()).toBeNull();
    expect(store.reactions()).toEqual([]);
    expect(store.activeEpisodes()).toEqual([]);
    expect(store.careTeam()).toEqual([]);
  });

  it("cancels the previous patient's requests, so their late answers are never applied", () => {
    store.load('a');
    store.load('b');
    expect(responses['/patients/a'].observed).toBe(false);
    responses['/patients/a'].next({ id: 'a', fullName: 'A' });
    expect(store.patient()).toBeNull();
  });

  it("applies a tab's written-back patient only while it is still the hub's patient", () => {
    store.load('b');
    store.acceptPatient({ id: 'a', fullName: 'A' } as any);
    expect(store.patient()).toBeNull();
    expect(store.isCurrent('a')).toBe(false);
    store.acceptPatient({ id: 'b', fullName: 'B' } as any);
    expect(store.patient()?.fullName).toBe('B');
  });
});
