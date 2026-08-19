import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { PatientHistoryPage } from './patient-history.page';
import { PatientHubStore } from '../patient-hub.store';
import { ApiClientService } from '../../core/api-client.service';

describe('PatientHistoryPage', () => {
  let apiMock: any;
  let routerMock: any;

  const build = () => {
    const store = TestBed.inject(PatientHubStore);
    store.patientId.set('p1');
    const fixture = TestBed.createComponent(PatientHistoryPage);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path === '/patients/p1/conditions') return of([{ id: 'c1', name: 'Asthma', status: 'active' }]);
        if (path === '/patients/p1/episodes')
          return of([
            { id: 'e1', name: 'Fever Jan', status: 'resolved', startedAt: 1700000000 },
            { id: 'e2', name: 'Cough', status: 'active', startedAt: null },
          ]);
        return of([]);
      }),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientHistoryPage],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('lists conditions and every episode, resolved ones included', () => {
    // Unfiltered on purpose: past episodes are the point of a history view, not noise in it.
    const fixture = build();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Asthma');
    expect(text).toContain('Fever Jan');
    expect(text).toContain('Cough');
  });

  it('offers no way to create an episode', () => {
    // Episodes only ever start as a side effect of logging (P5).
    const fixture = build();
    const labels = Array.from(fixture.nativeElement.querySelectorAll('button')).map((b: any) => b.textContent.trim());
    expect(labels.some((l: string) => /new episode|add episode/i.test(l))).toBe(false);
  });

  it('says so when episodes cannot be loaded', () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/patients/p1/episodes' ? throwError(() => ({ error: { message: 'boom' } })) : of([]),
    );
    const fixture = build();
    expect(fixture.componentInstance.episodesError()).toBe('Could not load episodes.');
  });

  it('routes to conditions, episodes and the lab import', () => {
    const fixture = build();
    const component = fixture.componentInstance;
    component.goToNewCondition();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'conditions', 'new']);
    component.goToCondition('c1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/conditions', 'c1']);
    component.goToEpisode('e1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'e1']);
    component.goToLabImport();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'lab-import']);
  });
});
