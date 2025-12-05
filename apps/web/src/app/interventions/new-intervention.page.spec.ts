import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewInterventionPage } from './new-intervention.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { Router } from '@angular/router';

describe('NewInterventionPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn(),
      post: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        id: 'u1',
        displayName: 'Tester',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
        email: 't@example.com',
      }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewInterventionPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads patients and submits medication dose', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes('/episodes')) {
        return of([{ id: 'ep1', name: 'Episode 1' }]);
      }
      return of([{ id: 'p1', fullName: 'Patient 1' }]);
    });
    apiMock.post.mockReturnValue(of({}));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseSource: 'override',
      amountMg: 100,
      episodeSelection: ['ep1'],
      resolveSelected: true,
    });
    component.submit();
    expect(apiMock.get).toHaveBeenCalledWith('/users/u1/patients');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/interventions',
      expect.objectContaining({
        type: 'medication_dose',
        medicationId: 'med-1',
        amountMg: 100,
        episodeIds: ['ep1'],
        resolvesEpisodeIds: ['ep1'],
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('shows error on failure', () => {
    apiMock.get.mockReturnValue(of([{ id: 'p1', fullName: 'Patient 1' }]));
    apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(NewInterventionPage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      patientId: 'p1',
      type: 'medication_dose',
      medicationId: 'med-1',
      doseSource: 'override',
      amountMg: 100,
    });
    component.submit();
    expect(component.error()).toBeDefined();
  });
});
