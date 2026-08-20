import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../core/auth.service';
import { formatAge, isWeightStale, weightAgeDays } from '../core/patient-display';
import { PatientHubStore } from './patient-hub.store';

/**
 * The patient hub (frontend.md → "Information architecture (v2)").
 *
 * `/patients/:id` used to be an edit form that also happened to be the only way through to the
 * timeline, ER brief and lab import. It is now a shell: a persistent identity header — the things
 * that stay true no matter which tab you are on — over a tab strip and the tabs' own content.
 *
 * The `now` tab is deliberately absent; it needs the bimodal Home work and a `recentTemperatures`
 * payload that does not exist yet, so the default child is `journal`.
 */
@Component({
  selector: 'app-patient-hub-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="hub">
      <header class="hub-header card accent-rail" [ngClass]="accentClass()">
        <div class="identity">
          <!-- The patient's accent color, on every tab (frontend.md → "Patient identity"). The
               rail carries it without being read; the dot ties it to the name so the association
               is learnable in the first place. -->
          <h1><span class="accent-dot"></span>{{ store.patient()?.fullName || 'Patient' }}</h1>
          <div class="meta">
            <span class="muted" *ngIf="age() as a">{{ a }}</span>
            <span class="muted sex" *ngIf="store.patient() as p">{{ p.sexAtBirth }}</span>
            <!-- Allergies are header material on the ER Brief; the hub mirrors that priority so a
                 danger-class reaction is visible from every tab, not just the one that lists it. -->
            <span class="pill pill-danger" *ngFor="let r of store.dangerReactions()">
              ⚠ {{ r.description }}
            </span>
            <span class="pill pill-neutral" *ngFor="let ep of store.activeEpisodes()">
              {{ ep.name }}
            </span>
            <span class="pill pill-warn" *ngIf="weightStale()">{{ weightLabel() }}</span>
          </div>
        </div>
        <!-- The ER Brief is a handoff artifact, not an access-control screen, and it is wanted in a
             hurry. A header action puts it one tap from every tab instead of behind one. -->
        <div class="header-actions">
          <button class="secondary" type="button" (click)="goToErBrief()">ER Brief</button>
        </div>
      </header>

      <p class="error" *ngIf="store.error()">{{ store.error() }}</p>

      <nav class="tab-bar" #tabBar>
        <a class="tab-link" routerLink="journal" routerLinkActive="active">Journal</a>
        <a class="tab-link" routerLink="photos" routerLinkActive="active">Photos</a>
        <a class="tab-link" routerLink="meds" routerLinkActive="active">Meds</a>
        <a class="tab-link" routerLink="history" routerLinkActive="active">History</a>
        <a class="tab-link" routerLink="care-team" routerLinkActive="active">Care team</a>
        <a class="tab-link settings-tab" routerLink="settings" routerLinkActive="active">⚙ Settings</a>
      </nav>

      <!-- Held back until the signed-in user resolves. Tabs read preferences off the user for unit
           display, and a child constructed before /users/me lands reads the wrong defaults. -->
      <router-outlet *ngIf="ready()"></router-outlet>
    </div>
  `,
  styles: [
    `
      .hub {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .hub-header {
        padding: 1rem 1.25rem;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.35rem;
      }
      /* Only the enum gets title-cased. A reaction description is the caregiver's own sentence
         ("throat swelled up") and must render as they typed it. */
      .sex {
        text-transform: capitalize;
      }
      .pill-warn {
        background: rgba(252, 211, 77, 0.12);
        border: 1px solid rgba(252, 211, 77, 0.4);
        color: #fcd34d;
      }
      /* No auto left margin: an unlabelled glyph exiled to the far right is how patient editing
         became unfindable in the first place. It sits with its siblings and says what it is. */
      .settings-tab {
        font-size: 0.95rem;
      }
    `,
  ],
  providers: [],
})
export class PatientHubShell implements OnInit, AfterViewInit {
  protected readonly store = inject(PatientHubStore);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @ViewChild('tabBar') private tabBar?: ElementRef<HTMLElement>;

  ready = signal(false);

  age = computed(() => formatAge(this.store.patient()?.dateOfBirth));
  // Empty until the patient lands, which matches no palette rule and leaves the neutral fallback
  // in place — a header that guessed a color and then changed it would teach the wrong thing.
  accentClass = computed(() => {
    const token = this.store.patient()?.accentColor;
    return token ? `accent-${token}` : '';
  });
  weightStale = computed(() => !!this.store.patient() && isWeightStale(this.store.patient()!.latestWeightRecordedAt));
  weightLabel = computed(() => {
    const days = weightAgeDays(this.store.patient()?.latestWeightRecordedAt);
    return days === null ? 'weight never recorded' : `weight ${days} days old`;
  });

  ngOnInit(): void {
    const patientId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!patientId) {
      this.router.navigateByUrl('/patients');
      return;
    }
    // Done once here for the whole subtree instead of once per tab, which is what the eight
    // hand-rolled copies of this block elsewhere in the app amount to.
    if (!this.auth.user() && this.auth.token) {
      this.auth.me().subscribe({
        next: () => this.start(patientId),
        error: () => this.auth.logout(),
      });
    } else {
      this.start(patientId);
    }
  }

  /**
   * Keep the active tab on screen.
   *
   * Below 560px the tab bar is a single scrolling row rather than three wrapped ones, which buys
   * back ~90px above every tab's content — but the tab you are actually on can then start off
   * past the right edge. Landing on Care team showed "Journal Photos Meds History" with nothing
   * highlighted, which reads as being on no tab at all.
   *
   * scrollLeft rather than scrollIntoView: the latter also scrolls the nearest scrollable
   * ancestor, so arriving at a hub tab would jump the page down past the identity header.
   */
  ngAfterViewInit(): void {
    this.revealActiveTab();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.revealActiveTab());
  }

  private revealActiveTab(): void {
    // A tick, because routerLinkActive applies its class during the change detection run that
    // follows navigation — read any sooner and the previous tab is still the active one.
    setTimeout(() => {
      const bar = this.tabBar?.nativeElement;
      const active = bar?.querySelector<HTMLElement>('.tab-link.active');
      if (!bar || !active) return;
      const overflowRight = active.offsetLeft + active.offsetWidth - (bar.scrollLeft + bar.clientWidth);
      if (overflowRight > 0) bar.scrollLeft += overflowRight + 16;
      else if (active.offsetLeft < bar.scrollLeft) bar.scrollLeft = Math.max(0, active.offsetLeft - 16);
    });
  }

  goToErBrief() {
    this.router.navigate(['/patients', this.store.patientId(), 'er-brief']);
  }

  private start(patientId: string) {
    this.store.load(patientId);
    this.ready.set(true);
  }
}
