import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { OidcCompletePage } from './oidc-complete.page';
import { AuthService } from '../core/auth.service';
import { ERROR_SENTENCES } from '../core/error-display';

describe('OidcCompletePage', () => {
  let fixture: ComponentFixture<OidcCompletePage>;
  let component: OidcCompletePage;
  let authMock: { completeOidc: jest.Mock; token: string | null };

  async function setup(code: string | null) {
    // `token` is a getter on the real service; the page reads it to tell a harmless replay
    // (already signed in) from a genuine failure.
    authMock = { completeOidc: jest.fn(), token: null };

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
    // replaceUrl, so the spent single-use code does not stay in history for a back gesture to
    // replay — that replay is what turns a successful sign-in into an error screen.
    expect(navSpy).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    expect(component.error()).toBeNull();
  });

  it('shows an error and never calls the API when the code is missing from the URL', async () => {
    await setup(null);
    fixture.detectChanges();
    expect(authMock.completeOidc).not.toHaveBeenCalled();
    expect(component.error()).toContain('missing its code');
  });

  it('distinguishes an expired code from one the server never issued', async () => {
    await setup('stale-code');
    authMock.completeOidc.mockReturnValue(
      throwError(() => ({ error: { message: 'OIDC_HANDOFF_EXPIRED' } })),
    );
    fixture.detectChanges();
    expect(component.error()).toBe(
      'This sign-in link timed out before it was used. Sign in again to get a fresh one.',
    );
  });

  it('falls back to a sentence that is not any mapped code, so a 502 cannot masquerade as an expired link', async () => {
    await setup('some-code');
    // No machine-readable code at all — an ingress 502, a gateway timeout, a dropped connection.
    // This used to render the exact OIDC_HANDOFF_NOT_FOUND sentence, which is how a two-replica
    // handoff outage stayed hidden behind "this link expired" (security.md → "OIDC login").
    authMock.completeOidc.mockReturnValue(
      throwError(() => ({ status: 502, error: '<html>502 Bad Gateway</html>' })),
    );
    fixture.detectChanges();
    expect(component.error()).toBe('Sign-in could not be completed. Try signing in again.');
    expect(component.error()).not.toBe(ERROR_SENTENCES.OIDC_HANDOFF_NOT_FOUND);
    expect(component.error()).not.toBe(ERROR_SENTENCES.OIDC_HANDOFF_EXPIRED);
    expect(component.error()).not.toBe(ERROR_SENTENCES.OIDC_HANDOFF_ALREADY_USED);
  });

  // A back navigation onto a spent code, or a second tab, once the session already landed. The
  // sign-in worked; showing a red error screen for it would be a lie.
  it('goes to the dashboard rather than erroring when the code is spent but a session is live', async () => {
    await setup('spent-code');
    authMock.token = 'a-live-session';
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true as any);
    authMock.completeOidc.mockReturnValue(
      throwError(() => ({ error: { message: 'OIDC_HANDOFF_ALREADY_USED' } })),
    );

    fixture.detectChanges();

    expect(navSpy).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    expect(component.error()).toBeNull();
  });

  it('still errors on a spent code when there is no session to fall back on', async () => {
    await setup('spent-code');
    authMock.token = null;
    authMock.completeOidc.mockReturnValue(
      throwError(() => ({ error: { message: 'OIDC_HANDOFF_ALREADY_USED' } })),
    );
    fixture.detectChanges();
    expect(component.error()).toBe(ERROR_SENTENCES.OIDC_HANDOFF_ALREADY_USED);
  });
});
