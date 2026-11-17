import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_BASE_HREF } from '@angular/common';
import {
  NavigationError,
  Router,
  provideRouter,
  withNavigationErrorHandler,
} from '@angular/router';
import {
  HARD_NAVIGATE,
  STALE_BUILD_RETRY_KEY,
  STALE_BUILD_RETRY_WINDOW_MS,
  StaleBuildRecovery,
  isChunkLoadError,
  provideStaleBuildRecovery,
  staleBuildNavigationErrorHandler,
} from './stale-build';
import {
  DeferredChunkFailedComponent,
  StaleBuildBannerComponent,
} from './stale-build-banner.component';

@Component({ standalone: true, template: 'home' })
class HomeStub {}

/** What Firefox rejects a dynamic import with when the chunk came back as text/html (or 404). */
const firefoxChunkError = () =>
  new TypeError(
    'error loading dynamically imported module: https://salud.bpd.sh/chunk-FKJVOJO3.js'
  );

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/chunk-AAAAAAAA.js', // Chromium
    'error loading dynamically imported module: https://x/chunk-AAAAAAAA.js', // Firefox
    'Importing a module script failed.', // Safari
    'Loading chunk 123 failed.', // webpack
  ])('recognises %p', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('recognises a ChunkLoadError by name', () => {
    const e = new Error('whatever');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it.each([
    [new Error('PATIENT_NOT_FOUND')],
    [new TypeError("Cannot read properties of undefined (reading 'id')")],
    [null],
    [undefined],
    [{}],
  ])('ignores %p', (e) => {
    expect(isChunkLoadError(e)).toBe(false);
  });
});

describe('stale-build recovery through the router', () => {
  let hardNavigate: jest.Mock;
  let router: Router;
  let recovery: StaleBuildRecovery;
  let loadNewObservation: jest.Mock;

  beforeEach(() => {
    sessionStorage.clear();
    hardNavigate = jest.fn();
    // What a stale tab sees for every chunk it doesn't hold yet: the import rejects.
    loadNewObservation = jest.fn(() => Promise.reject(firefoxChunkError()));
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_BASE_HREF, useValue: '/' },
        { provide: HARD_NAVIGATE, useValue: hardNavigate },
        provideRouter(
          [
            { path: 'dashboard', component: HomeStub },
            { path: 'observations/new', loadComponent: loadNewObservation },
          ],
          withNavigationErrorHandler(staleBuildNavigationErrorHandler)
        ),
        provideStaleBuildRecovery(),
      ],
    });
    router = TestBed.inject(Router);
    recovery = TestBed.inject(StaleBuildRecovery);
  });

  afterEach(() => sessionStorage.clear());

  /** Navigations to a failing route still reject (the handler adds recovery, it hides nothing). */
  const navigate = (url: string) => router.navigateByUrl(url).catch(() => false);

  it('reloads once, at the URL being navigated to, when a lazy chunk fails', async () => {
    await navigate('/dashboard');
    await navigate('/observations/new?patientId=p1');

    expect(hardNavigate).toHaveBeenCalledTimes(1);
    expect(hardNavigate).toHaveBeenCalledWith('/observations/new?patientId=p1');
    expect(JSON.parse(sessionStorage.getItem(STALE_BUILD_RETRY_KEY)!).url).toBe(
      '/observations/new?patientId=p1'
    );
    expect(recovery.failedUrl()).toBeNull();
  });

  it('does not reload again when the reloaded page fails the same way; shows the fallback', async () => {
    // State the reload above leaves behind: the marker is in this tab's sessionStorage.
    sessionStorage.setItem(
      STALE_BUILD_RETRY_KEY,
      JSON.stringify({ url: '/observations/new', at: Date.now() - 2_000 })
    );

    await navigate('/observations/new');
    await navigate('/observations/new');

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(recovery.failedUrl()).toBe('/observations/new');
  });

  it('reloads again for a marker older than the retry window (a later deploy)', async () => {
    sessionStorage.setItem(
      STALE_BUILD_RETRY_KEY,
      JSON.stringify({ url: '/x', at: Date.now() - STALE_BUILD_RETRY_WINDOW_MS - 1 })
    );

    await navigate('/observations/new');

    expect(hardNavigate).toHaveBeenCalledWith('/observations/new');
  });

  it('clears the marker and the fallback once a navigation completes', async () => {
    sessionStorage.setItem(STALE_BUILD_RETRY_KEY, JSON.stringify({ url: '/x', at: Date.now() }));
    recovery.failedUrl.set('/x');

    await navigate('/dashboard');

    expect(sessionStorage.getItem(STALE_BUILD_RETRY_KEY)).toBeNull();
    expect(recovery.failedUrl()).toBeNull();
  });

  it('leaves non-chunk navigation errors alone', async () => {
    loadNewObservation.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(router.navigateByUrl('/observations/new')).rejects.toThrow('boom');

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(recovery.failedUrl()).toBeNull();
  });

  it('still rejects the navigation for a chunk error, so the failure is never silent', async () => {
    await expect(router.navigateByUrl('/observations/new')).rejects.toThrow(
      /dynamically imported module/
    );
  });

  it('shows the fallback instead of risking a loop when sessionStorage is unusable', async () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    try {
      await navigate('/observations/new');
    } finally {
      getItem.mockRestore();
    }

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(recovery.failedUrl()).toBe('/observations/new');
  });

  it('shows the fallback when the marker cannot be written', async () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    try {
      await navigate('/observations/new');
    } finally {
      setItem.mockRestore();
    }

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(recovery.failedUrl()).toBe('/observations/new');
  });

  it('handleNavigationError ignores errors that are not chunk failures', () => {
    recovery.handleNavigationError(new NavigationError(1, '/a', new Error('nope')));
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});

describe('StaleBuildBannerComponent', () => {
  let hardNavigate: jest.Mock;

  beforeEach(() => {
    sessionStorage.clear();
    hardNavigate = jest.fn();
    TestBed.configureTestingModule({
      imports: [StaleBuildBannerComponent],
      providers: [
        { provide: APP_BASE_HREF, useValue: '/' },
        { provide: HARD_NAVIGATE, useValue: hardNavigate },
        provideRouter([]),
      ],
    });
  });

  afterEach(() => sessionStorage.clear());

  it('renders nothing until a retry has failed', () => {
    const fixture = TestBed.createComponent(StaleBuildBannerComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="stale-build-banner"]')).toBeNull();
  });

  it('shows a Reload button that clears the marker and loads the failed URL', () => {
    sessionStorage.setItem(STALE_BUILD_RETRY_KEY, JSON.stringify({ url: '/a', at: Date.now() }));
    TestBed.inject(StaleBuildRecovery).failedUrl.set('/interventions/new');
    const fixture = TestBed.createComponent(StaleBuildBannerComponent);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('[data-testid="stale-build-banner"]');
    expect(banner.getAttribute('role')).toBe('alert');
    fixture.nativeElement.querySelector('[data-testid="stale-build-reload"]').click();

    expect(hardNavigate).toHaveBeenCalledWith('/interventions/new');
    expect(sessionStorage.getItem(STALE_BUILD_RETRY_KEY)).toBeNull();
  });
});

describe('DeferredChunkFailedComponent', () => {
  it('hands a failed @defer chunk to the same one-shot recovery, at the current page', async () => {
    sessionStorage.clear();
    const hardNavigate = jest.fn();
    TestBed.configureTestingModule({
      imports: [DeferredChunkFailedComponent],
      providers: [
        { provide: APP_BASE_HREF, useValue: '/' },
        { provide: HARD_NAVIGATE, useValue: hardNavigate },
        provideRouter([{ path: 'dashboard', component: HomeStub }]),
      ],
    });
    await TestBed.inject(Router).navigateByUrl('/dashboard');

    TestBed.createComponent(DeferredChunkFailedComponent);

    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
    sessionStorage.clear();
  });
});
