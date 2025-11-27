import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiClientService } from './api-client.service';

describe('AuthService', () => {
  let service: AuthService;
  let apiMock: {
    post: jest.Mock;
    get: jest.Mock;
    patch: jest.Mock;
  };
  let routerMock: { navigateByUrl: jest.Mock };

  beforeEach(() => {
    apiMock = {
      post: jest.fn(),
      get: jest.fn(),
      patch: jest.fn(),
    };
    routerMock = {
      navigateByUrl: jest.fn(),
    };
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  it('stores token and user on login', (done) => {
    apiMock.post.mockReturnValue(
      of({
        token: 'abc',
        user: {
          id: 'u1',
          email: 'a@example.com',
          displayName: 'A',
          preferredTempUnit: 'F',
          preferredLengthUnit: 'cm',
          preferredWeightUnit: 'kg',
        },
      }),
    );

    service.login({ email: 'a@example.com', password: 'pw' }).subscribe(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/auth/login', {
        email: 'a@example.com',
        password: 'pw',
      });
      expect(localStorage.getItem('salud_jwt')).toBe('abc');
      expect(service.user()?.id).toBe('u1');
      done();
    });
  });

  it('updates user on me()', (done) => {
    apiMock.get.mockReturnValue(
      of({
        user: {
          id: 'u2',
          email: 'b@example.com',
          displayName: 'B',
          preferredTempUnit: 'C',
          preferredLengthUnit: 'in',
          preferredWeightUnit: 'lb',
        },
      }),
    );
    service.me().subscribe(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/users/me');
      expect(service.user()?.email).toBe('b@example.com');
      done();
    });
  });

  it('clears session on logout', () => {
    localStorage.setItem('salud_jwt', 'token');
    (service as any).userSignal.set({
      id: 'u',
      email: 'e',
      displayName: 'd',
      preferredTempUnit: 'F',
      preferredLengthUnit: 'cm',
      preferredWeightUnit: 'kg',
    });
    service.logout();
    expect(localStorage.getItem('salud_jwt')).toBeNull();
    expect(service.user()).toBeNull();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/login');
  });
});
