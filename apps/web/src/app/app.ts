import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './core/auth.service';
import { ApiClientService } from './core/api-client.service';
import { QuickLogSheetComponent } from './quick-log/quick-log-sheet.component';
import { Patient } from '@salud/shared/types';

/** `/patients/<uuid>` — anything deeper is still inside that patient's hub. */
const HUB_PATH = /^\/patients\/([0-9a-fA-F-]{36})(\/|$)/;

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, QuickLogSheetComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);

  protected title = 'web';
  protected menuOpen = signal(false);
  protected quickLogOpen = signal(false);
  protected currentPath = signal<string>('');
  protected patients = signal<Patient[]>([]);
  protected user = this.auth.user;
  protected isAuthed = computed(() => !!this.user());
  protected isLoginRoute = computed(() => this.currentPath().startsWith('/login'));
  protected isRegisterRoute = computed(() => this.currentPath().startsWith('/register'));

  /**
   * Inside a patient hub the `+` is already scoped to that patient, so Quick Log skips the "who is
   * this for?" step entirely — the hub answered it (frontend.md → "Information architecture (v2)"
   * → App shell). Read off the URL rather than from PatientHubStore, which is provided on the
   * `patients/:id` route and so is not injectable from the shell above it.
   */
  protected hubPatientId = computed(() => HUB_PATH.exec(this.currentPath())?.[1] ?? null);

  ngOnInit(): void {
    if (this.auth.token && !this.user()) {
      this.auth.me().subscribe({
        next: () => this.loadPatients(),
        error: () => {
          // If token invalid, log out silently
          this.auth.logout();
        },
      });
    } else if (this.auth.token) {
      this.loadPatients();
    }
    this.currentPath.set(this.router.url ?? '');
    this.router.events.subscribe((evt: any) => {
      if (evt instanceof NavigationEnd) {
        this.currentPath.set(evt.urlAfterRedirects);
        this.menuOpen.set(false);
      }
    });
  }

  /** The rail's patient list. A failure leaves the rail's other links working rather than erroring. */
  private loadPatients(): void {
    this.api.get<Patient[]>('/patients').subscribe({
      next: (res) => this.patients.set(res),
      error: () => this.patients.set([]),
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
    this.closeQuickLog();
  }

  openQuickLog() {
    this.menuOpen.set(false);
    this.quickLogOpen.set(true);
  }

  closeQuickLog() {
    this.quickLogOpen.set(false);
  }

  logout() {
    this.auth.logout();
    this.patients.set([]);
    this.menuOpen.set(false);
    this.quickLogOpen.set(false);
  }
}
