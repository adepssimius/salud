import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClientService } from './api-client.service';
import { PatientNameStore } from './patient-name.store';

describe('PatientNameStore', () => {
  let store: PatientNameStore;
  let apiMock: { get: jest.Mock };

  beforeEach(() => {
    apiMock = { get: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        PatientNameStore,
        { provide: ApiClientService, useValue: apiMock },
      ],
    });
    store = TestBed.inject(PatientNameStore);
  });

  it('returns null for a patient it has never seen', () => {
    expect(store.name('p1')).toBeNull();
  });

  it('remembers a name handed to it without touching the network', () => {
    store.remember({ id: 'p1', fullName: 'Ada Lovelace' });
    expect(store.name('p1')).toBe('Ada Lovelace');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('does not fetch an id a page already published', () => {
    store.remember({ id: 'p1', fullName: 'Ada Lovelace' });
    store.ensure('p1');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('fetches an id nobody has published, once', () => {
    apiMock.get.mockReturnValue(of({ id: 'p1', fullName: 'Ada Lovelace' }));
    store.ensure('p1');
    store.ensure('p1');
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1');
    expect(store.name('p1')).toBe('Ada Lovelace');
  });

  it('swallows a failed fetch and leaves the name unset', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('404')));
    expect(() => store.ensure('p1')).not.toThrow();
    expect(store.name('p1')).toBeNull();
  });

  it('picks up a rename when a page republishes the patient', () => {
    store.remember({ id: 'p1', fullName: 'Ada Lovelace' });
    store.remember({ id: 'p1', fullName: 'Ada Byron' });
    expect(store.name('p1')).toBe('Ada Byron');
  });

  it('ignores a patient with no name rather than caching a blank', () => {
    store.remember({ id: 'p1', fullName: '' });
    expect(store.name('p1')).toBeNull();
  });

  it('remembers a whole list at once', () => {
    store.rememberAll([
      { id: 'p1', fullName: 'Ada Lovelace' },
      { id: 'p2', fullName: 'Alan Turing' },
    ]);
    expect(store.name('p2')).toBe('Alan Turing');
  });
});
