import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewObservationPage } from './new-observation.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { Router } from '@angular/router';

describe('NewObservationPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of([])),
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigateByUrl: jest.fn(), navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewObservationPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads patients and creates observation', () => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Pat', dateOfBirth: '2020-01-01', sexAtBirth: 'female', notes: null, ownedById: 'u1', latestWeightKg: null, latestWeightRecordedAt: null, myRole: 'parent' }]));
    apiMock.post.mockReturnValue(of({}));

    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', observedAt: '2025-01-01T10:00', symptomTags: 'cough' });
    comp.entryType = 'temperature';
    comp.entryMetadata = '{"valueC":37.5,"inputUnit":"C"}';
    comp.addEntry();
    comp.submit();
    expect(apiMock.post).toHaveBeenCalled();
  });

  it('shows error on bad metadata', () => {
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.entryMetadata = '{bad';
    comp.addEntry();
    expect(comp.error()).toBe('Metadata must be valid JSON');
  });

  it('handles api error', () => {
    apiMock.get.mockReturnValue(of([]));
    apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(NewObservationPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ patientId: 'p1', observedAt: '2025-01-01T10:00' });
    comp.addEntry();
    comp.submit();
    expect(comp.error()).toBe('Could not save observation.');
  });
});
