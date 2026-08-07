import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './core/auth.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: AuthService,
          useValue: {
            token: null,
            user: () => () => null,
            me: () => ({ subscribe: () => ({}) }),
            logout: jest.fn(),
          },
        },
        provideRouter([]),
      ],
    }).compileComponents();
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
});
