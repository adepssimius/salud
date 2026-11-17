import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Route, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from './app.routes';
import { AuthService } from './core/auth.service';
import { ApiClientService } from './core/api-client.service';

@Component({ standalone: true, template: 'stub' })
class StubPage {}

/**
 * The real route table — redirects and guards as shipped — with every lazy page swapped for a stub,
 * so this exercises where a visit lands without loading (and fetching for) the pages themselves.
 */
function stubbed(routes: Route[]): Route[] {
  return routes.map((r) => ({
    ...r,
    ...(r.loadComponent ? { loadComponent: () => StubPage } : {}),
    ...(r.children ? { children: stubbed(r.children) } : {}),
  }));
}

/** A JWT-shaped token; only the payload's `exp` is read client-side. */
function jwt(expSecondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `h.${btoa(JSON.stringify({ sub: 'u1', exp }))}.s`;
}

describe('app routes: where a visit lands', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(stubbed(appRoutes)),
        { provide: ApiClientService, useValue: {} },
      ],
    });
    router = TestBed.inject(Router);
  });

  async function land(url: string): Promise<string> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return router.url;
  }

  it('signed in at / goes to the dashboard', async () => {
    localStorage.setItem('salud_jwt', jwt(3600));
    expect(await land('/')).toBe('/dashboard');
  });

  it('signed in at /login goes to the dashboard', async () => {
    localStorage.setItem('salud_jwt', jwt(3600));
    expect(await land('/login')).toBe('/dashboard');
  });

  it('signed in at /register goes to the dashboard', async () => {
    localStorage.setItem('salud_jwt', jwt(3600));
    expect(await land('/register')).toBe('/dashboard');
  });

  it('signed out at / goes to /login', async () => {
    expect(await land('/')).toBe('/login');
  });

  it('signed out at /login stays on /login', async () => {
    expect(await land('/login')).toBe('/login');
  });

  it('an expired token goes to /login once and is cleared', async () => {
    localStorage.setItem('salud_jwt', jwt(-60));
    const harness = await RouterTestingHarness.create();
    const landed: string[] = [];
    router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) landed.push(e.urlAfterRedirects);
    });

    await harness.navigateByUrl('/');
    expect(router.url).toBe('/login');
    expect(localStorage.getItem('salud_jwt')).toBeNull();
    // Straight to /login, never rendering the dashboard first (no dashboard → 401 → login trip).
    expect(landed).toEqual(['/login']);
    expect(TestBed.inject(AuthService).hasSession()).toBe(false);
  });
});
