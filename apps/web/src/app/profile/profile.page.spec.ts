import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProfilePage } from './profile.page';
import { AuthService } from '../core/auth.service';

describe('ProfilePage', () => {
  let authMock: any;

  beforeEach(async () => {
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({
        displayName: 'Tester',
        email: 't@example.com',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
        id: 'u1',
      }),
      me: jest.fn(),
      updateProfile: jest.fn(),
      logout: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [{ provide: AuthService, useValue: authMock }],
    }).compileComponents();
  });

  it('prefills from user signal', () => {
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.form.getRawValue().displayName).toBe('Tester');
  });

  it('submits updates', () => {
    authMock.updateProfile.mockReturnValue(
      of({
        user: {
          displayName: 'Updated',
          email: 't@example.com',
          preferredTempUnit: 'C',
          preferredLengthUnit: 'in',
          preferredWeightUnit: 'lb',
          id: 'u1',
        },
      }),
    );
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({
      displayName: 'Updated',
      preferredTempUnit: 'C',
      preferredLengthUnit: 'in',
      preferredWeightUnit: 'lb',
    });
    component.submit();
    expect(authMock.updateProfile).toHaveBeenCalled();
    expect(component.form.getRawValue().preferredTempUnit).toBe('C');
  });
});
