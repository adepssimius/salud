import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './core/auth.service';

@Component({
  imports: [RouterOutlet, RouterLink, CommonModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected title = 'web';
  protected menuOpen = signal(false);
  protected currentPath = signal<string>('');
  protected user = this.auth.user;
  protected isAuthed = computed(() => !!this.user());
  protected isLoginRoute = computed(() => this.currentPath().startsWith('/login'));
  protected isRegisterRoute = computed(() => this.currentPath().startsWith('/register'));

  ngOnInit(): void {
    if (this.auth.token && !this.user()) {
      this.auth.me().subscribe({
        error: () => {
          // If token invalid, log out silently
          this.auth.logout();
        },
      });
    }
    this.currentPath.set(this.router.url ?? '');
    this.router.events.subscribe((evt: any) => {
      if (evt instanceof NavigationEnd) {
        this.currentPath.set(evt.urlAfterRedirects);
        this.menuOpen.set(false);
      }
    });
  }

  toggleMenu() {
    this.menuOpen.update((v) => !v);
  }

  // Click-outside-to-close lives here rather than on a (click) handler on <main>: a click handler on
  // a non-interactive element is a keyboard trap for anyone not using a mouse (and a lint error).
  // The toggle button stops propagation so opening the menu doesn't immediately close it again.
  @HostListener('document:click')
  closeMenu() {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeMenu();
  }

  logout() {
    this.auth.logout();
    this.menuOpen.set(false);
  }
}
