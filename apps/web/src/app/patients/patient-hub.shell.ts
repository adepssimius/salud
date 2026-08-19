import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
      <header class="hub-header card">
        <div class="identity">
          <h1>{{ store.patient()?.fullName || 'Patient' }}</h1>
          <div class="meta">
            <span class="muted" *ngIf="age() as a">{{ a }}</span>
            <span class="muted" *ngIf="store.patient() as p">{{ p.sexAtBirth }}</span>
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
      </header>

      <p class="error" *ngIf="store.error()">{{ store.error() }}</p>

      <nav class="tab-bar">
        <a class="tab-link" routerLink="journal" routerLinkActive="active">Journal</a>
        <a class="tab-link settings-tab" routerLink="settings" routerLinkActive="active" title="Settings">⚙</a>
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
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.35rem;
        text-transform: capitalize;
      }
      .pill-warn {
        background: rgba(252, 211, 77, 0.12);
        border: 1px solid rgba(252, 211, 77, 0.4);
        color: #fcd34d;
      }
      .settings-tab {
        margin-left: auto;
        font-size: 1.05rem;
      }
    `,
  ],
  providers: [],
})
export class PatientHubShell implements OnInit {
  protected readonly store = inject(PatientHubStore);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ready = signal(false);

  age = computed(() => formatAge(this.store.patient()?.dateOfBirth));
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

  private start(patientId: string) {
    this.store.load(patientId);
    this.ready.set(true);
  }
}
