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
            logout: () => {},
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
});
