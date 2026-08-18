import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { OidcCompletePage } from './oidc-complete.page';
import { AuthService } from '../core/auth.service';

describe('OidcCompletePage', () => {
  let fixture: ComponentFixture<OidcCompletePage>;
  let component: OidcCompletePage;
  let authMock: { completeOidc: jest.Mock };

  async function setup(code: string | null) {
    authMock = { completeOidc: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [OidcCompletePage, RouterTestingModule.withRoutes([])],
      providers: [
        { provide: AuthService, useValue: authMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(code ? { code } : {}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OidcCompletePage);
    component = fixture.componentInstance;
  }

  it('exchanges the code and navigates to the dashboard on success', async () => {
    await setup('abc123');
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true as any);
    authMock.completeOidc.mockReturnValue(
      of({
        token: 't',
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

    fixture.detectChanges();

    expect(authMock.completeOidc).toHaveBeenCalledWith('abc123');
    expect(navSpy).toHaveBeenCalledWith('/dashboard');
    expect(component.error()).toBeNull();
  });

  it('shows an error and never calls the API when the code is missing from the URL', async () => {
    await setup(null);
    fixture.detectChanges();
    expect(authMock.completeOidc).not.toHaveBeenCalled();
    expect(component.error()).toContain('missing its code');
  });

  it('shows a plain sentence when the handoff code is expired or already used', async () => {
    await setup('stale-code');
    authMock.completeOidc.mockReturnValue(
      throwError(() => ({ error: { message: 'OIDC_HANDOFF_NOT_FOUND' } })),
    );
    fixture.detectChanges();
    expect(component.error()).toBe(
      'This sign-in link has expired or was already used. Try signing in again.',
    );
  });
});
