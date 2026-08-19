import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { App } from './app';
import { AuthService } from './core/auth.service';

const user = signal<any>({ id: 'u1', displayName: 'Dana' });

function configure(token: string | null = null) {
  return TestBed.configureTestingModule({
    imports: [App],
    providers: [
      {
        provide: AuthService,
        useValue: {
          token,
          user,
          me: () => ({ subscribe: () => ({}) }),
          logout: jest.fn(),
        },
      },
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();
}

describe('App', () => {
  beforeEach(async () => {
    user.set({ id: 'u1', displayName: 'Dana' });
    await configure();
  });

  it('should render the brand header', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Salud');
  });

  it('exposes the profile toggle as a real button so it is keyboard-reachable', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('[data-testid="profile-toggle"]');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the menu on toggle and closes it on an outside click', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="profile-toggle"]');

    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.menuOpen()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The menu must be a sibling of the button — nesting a link and a button inside a <button>
    // is invalid markup, which is what the old structure did.
    expect(fixture.nativeElement.querySelector('button .menu')).toBeNull();
    expect(fixture.nativeElement.querySelector('.profile-wrap .menu')).not.toBeNull();

    document.body.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.menuOpen()).toBe(false);
  });

  it('closes the menu on Escape', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    fixture.componentInstance.toggleMenu();
    fixture.detectChanges();
    expect(fixture.componentInstance.menuOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.menuOpen()).toBe(false);
  });

  // frontend.md → "Information architecture (v2)" → App shell.
  describe('shell navigation', () => {
    it('renders the bottom bar and the desktop rail for an authenticated caregiver', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const bottom = el.querySelector('.bottom-bar')!;
      expect(bottom).not.toBeNull();
      // Home, +, Patients — three slots, the `+` in the centre.
      expect(bottom.children.length).toBe(3);
      expect(bottom.children[1].getAttribute('data-testid')).toBe('quick-log-open');
      expect(el.querySelector('.side-rail')).not.toBeNull();
    });

    it('drops the v1 top-right nav link — Home is a bar slot and a rail link now', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const links = () => Array.from(el.querySelectorAll('.nav-actions a')).map((a) => a.textContent?.trim());
      expect(links()).not.toContain('Home');
      expect(links()).not.toContain('Dashboard');

      // What the header keeps is the avatar menu: Profile, Manage, Log out.
      fixture.componentInstance.toggleMenu();
      fixture.detectChanges();
      expect(links()).toEqual(['Edit profile', 'Manage']);
    });

    it('parks Manage at the bottom of the rail, off the urgent path', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const railLabels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.rail-bottom .rail-link'),
      ).map((a) => a.textContent?.trim());
      expect(railLabels).toEqual(['Manage']);
    });

    it('hides the bar and rail when signed out', async () => {
      user.set(null);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.bottom-bar')).toBeNull();
      expect(el.querySelector('.side-rail')).toBeNull();
    });
  });

  describe('quick log', () => {
    it('opens the sheet from the bottom bar + and closes it on Escape', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const add: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="quick-log-open"]');

      add.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.quickLogOpen()).toBe(true);
      // The sheet itself is a deferred chunk, so assert the state rather than awaiting the load.

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(fixture.componentInstance.quickLogOpen()).toBe(false);
    });

    // Inside a hub the + is already scoped, so Quick Log skips "who is this for?" entirely.
    it('scopes the sheet to the hub patient when one is in the URL', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const component = fixture.componentInstance as any;

      component.currentPath.set('/patients/2f1c1e58-3a2b-4a4e-9a2e-1a2b3c4d5e6f/meds');
      expect(component.hubPatientId()).toBe('2f1c1e58-3a2b-4a4e-9a2e-1a2b3c4d5e6f');

      component.currentPath.set('/patients');
      expect(component.hubPatientId()).toBeNull();
    });
  });

  it('fills the rail patient list from GET /patients when a session already exists', async () => {
    TestBed.resetTestingModule();
    await configure('a-token');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((req) => req.url.endsWith('/patients')).flush([{ id: 'p1', fullName: 'Ada' }]);
    fixture.detectChanges();

    const railNames = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.rail-section .rail-link'),
    ).map((a) => a.textContent?.trim());
    expect(railNames).toContain('Ada');
  });
});
