import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { PatientCareTeamPage } from './patient-care-team.page';
import { PatientHubStore } from '../patient-hub.store';
import { ApiClientService } from '../../core/api-client.service';
import { AuthService } from '../../core/auth.service';

const member = (id: string, name: string) => ({
  user: { id, email: `${name.toLowerCase()}@example.com`, displayName: name },
  role: 'parent',
});

describe('PatientCareTeamPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let store: PatientHubStore;

  const build = () => {
    store = TestBed.inject(PatientHubStore);
    store.patientId.set('p1');
    store.patient.set({ id: 'p1', fullName: 'Jamie', ownedById: 'u1' } as any);
    store.careTeam.set([member('u1', 'Owner'), member('u2', 'Dana')] as any);
    const fixture = TestBed.createComponent(PatientCareTeamPage);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    apiMock = { get: jest.fn().mockReturnValue(of([])), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Owner', email: 'owner@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientCareTeamPage],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('renders the care team from the hub store', () => {
    const fixture = build();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Dana');
    expect(text).toContain('Owner');
    // The shell loaded it; this tab must not fetch it again.
    expect(apiMock.get).not.toHaveBeenCalledWith('/patients/p1/care-team');
  });

  it('adds a caregiver through the store', () => {
    apiMock.post.mockReturnValue(of(member('u3', 'Sam')));
    const fixture = build();
    const component = fixture.componentInstance;
    component.openAddCaregiver();
    component.selectUser('u3');
    component.addCaregiver();
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/care-team', { userId: 'u3', role: 'other' });
    expect(store.careTeam().length).toBe(3);
    expect(component.addModalOpen()).toBe(false);
  });

  it('refuses to remove the owner', () => {
    const fixture = build();
    fixture.componentInstance.removeCaregiver(member('u1', 'Owner') as any);
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  it('removes a non-owner caregiver', () => {
    apiMock.delete.mockReturnValue(of({ deleted: true }));
    const fixture = build();
    fixture.componentInstance.removeCaregiver(member('u2', 'Dana') as any);
    expect(apiMock.delete).toHaveBeenCalledWith('/patients/p1/care-team/u2');
    expect(store.careTeam().length).toBe(1);
  });

  it('uses ownership-specific wording when a transfer target has gone', () => {
    // USER_NOT_FOUND reads differently for "add this caregiver" than for "make them the owner".
    apiMock.patch.mockReturnValue(throwError(() => ({ error: { message: 'USER_NOT_FOUND' } })));
    const fixture = build();
    fixture.componentInstance.makeOwner(member('u2', 'Dana') as any);
    expect(store.careTeamError()).toContain('no longer on this care team');
  });

  it('searches for a user by email', () => {
    apiMock.get.mockReturnValue(of([{ id: 'u9', email: 'new@example.com', displayName: 'New' }]));
    const fixture = build();
    const component = fixture.componentInstance;
    component.searchEmail = 'new@example.com';
    component.searchUsers();
    expect(apiMock.get).toHaveBeenCalledWith('/users/search', { email: 'new@example.com' });
    expect(component.selectedUserId).toBe('u9');
  });
});
