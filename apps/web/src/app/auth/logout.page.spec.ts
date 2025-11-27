import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LogoutPage } from './logout.page';
import { AuthService } from '../core/auth.service';

describe('LogoutPage', () => {
  it('calls logout on init', () => {
    const authMock = { logout: jest.fn() };
    TestBed.configureTestingModule({
      imports: [LogoutPage],
      providers: [{ provide: AuthService, useValue: authMock }, provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(LogoutPage);
    fixture.detectChanges();

    expect(authMock.logout).toHaveBeenCalled();
  });
});
