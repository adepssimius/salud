import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observation } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/error-display';
import { fromCm, unitsFor } from '../core/event-display';
import { PhotoThumbnailComponent } from '../core/photo-thumbnail.component';
import { PhotoItem, PhotoSite, collectPhotoItems, groupPhotosBySite } from '../core/photo-sites';
import { PatientHubStore } from '../patients/patient-hub.store';

/**
 * Photos by site — the patient hub's progression view (frontend.md → Photos → "Photos by site").
 *
 * Every photo entry already carries the site it was taken of (`bodyLocation`, `side`) and, often,
 * a size and a note. Until now none of that reached the screen: the journal renders each photo as
 * an undifferentiated thumbnail in the day it was logged, so a caregiver photographing a left and
 * a right ear drum over a week could not tell the two series apart, let alone read either one
 * forwards. This page is that missing read: the sites first, then one site's photos in time order.
 *
 * Two screens, one component and no second route: the site list, and a selected site's filmstrip.
 * Selecting a site is a reading move inside one view, not a navigation to a different subject —
 * and the whole payload is already in hand, so a route would only add a second fetch.
 *
 * Existing API only: `GET /patients/:id/observations?type=photo`, which returns whole observations
 * (photo entries alongside whatever else was saved in the same breath), and the authenticated blob
 * fetch inside PhotoThumbnailComponent. Attribution resolves against the hub's care-team list —
 * observations carry `recordedByUserId`, not a name, and the hub has already loaded the roster.
 */
@Component({
  selector: 'app-photos-page',
  standalone: true,
  imports: [CommonModule, PhotoThumbnailComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>{{ selectedSite() ? selectedSite()!.label : 'Photos' }}</h2>
          <p class="muted" *ngIf="!selectedSite()">
            Photo entries grouped by the site they were taken of.
          </p>
          <p class="muted" *ngIf="selectedSite() as site">
            {{ countLabel(site.count) }} · oldest first
          </p>
        </div>
        <div class="header-actions" *ngIf="selectedSite()">
          <button class="secondary" type="button" (click)="clearSite()">All sites</button>
        </div>
      </div>

      <p class="error" *ngIf="error()">{{ error() }}</p>

      <p class="muted" *ngIf="!error() && loaded() && !sites().length">
        No photos yet for this patient. Photos logged from an observation appear here, grouped by
        the body location and side they record.
      </p>

      <!-- Site list -->
      <ul class="row-list" *ngIf="!selectedSite() && sites().length">
        <li *ngFor="let site of sites()">
          <button type="button" class="site-button" (click)="selectSite(site.key)">
            <app-photo-thumbnail [fileId]="site.latest.fileId" [link]="false"></app-photo-thumbnail>
            <span class="site-text">
              <span class="name">{{ site.label }}</span>
              <span class="muted small">
                {{ countLabel(site.count) }} · latest {{ site.latest.timestamp * 1000 | date: 'mediumDate' }}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <!-- One site's progression, oldest → newest -->
      <ol class="filmstrip" *ngIf="selectedSite() as site">
        <li class="frame" *ngFor="let photo of site.photos">
          <app-photo-thumbnail [fileId]="photo.fileId" [full]="true"></app-photo-thumbnail>
          <div class="frame-meta">
            <span class="frame-date">{{ photo.timestamp * 1000 | date: 'medium' }}</span>
            <span class="muted small">{{ recordedBy(photo) }}</span>
            <span class="pill" *ngIf="sizeLabel(photo) as size">{{ size }}</span>
            <p class="frame-note" *ngIf="photo.note">{{ photo.note }}</p>
          </div>
        </li>
      </ol>
    </div>
  `,
  styles: [
    `
      h2 {
        margin: 0;
      }
      .card-header {
        align-items: center;
      }
      .site-button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-control);
        border: 1px solid var(--border);
        background: var(--surface-raised);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .site-text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .name {
        font-weight: 700;
      }
      .filmstrip {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      /* Column on a phone, photo-beside-its-facts on a desktop — the comparison the page exists
         for is between frames, so the frames stay stacked at every width (P7). */
      .frame {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      @media (min-width: 700px) {
        .frame {
          flex-direction: row;
          align-items: flex-start;
          gap: 1rem;
        }
      }
      .frame-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      .frame-date {
        font-weight: 700;
      }
      .frame-note {
        flex-basis: 100%;
        margin: 0;
      }
    `,
  ],
})
export class PhotosPage implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  protected readonly store = inject(PatientHubStore);

  photos = signal<PhotoItem[]>([]);
  error = signal<string | null>(null);
  /** Distinguishes "nothing photographed yet" from "the answer hasn't arrived" (frontend.md → Errors). */
  loaded = signal(false);
  selectedKey = signal<string | null>(null);

  sites = computed<PhotoSite[]>(() => groupPhotosBySite(this.photos()));
  selectedSite = computed<PhotoSite | null>(() => {
    const key = this.selectedKey();
    // Resolved by key rather than held as an object: a reload rebuilds the groups, and a stale
    // object would keep rendering photos that are no longer in the payload.
    return key ? this.sites().find((site) => site.key === key) ?? null : null;
  });

  get patientId() {
    return this.store.patientId();
  }

  ngOnInit(): void {
    this.load();
  }

  selectSite(key: string) {
    this.selectedKey.set(key);
  }

  clearSite() {
    this.selectedKey.set(null);
  }

  countLabel(count: number): string {
    return count === 1 ? '1 photo' : `${count} photos`;
  }

  /** Attribution (P3) — the roster the hub already loaded, same resolution as the Settings tab. */
  recordedBy(photo: PhotoItem): string {
    const member = this.store.careTeam().find((m) => m.user.id === photo.recordedByUserId);
    return `by ${member?.user.displayName || member?.user.email || 'someone'}`;
  }

  /** Stored canonically in cm; shown in the viewer's length preference like every other length. */
  sizeLabel(photo: PhotoItem): string | null {
    if (photo.sizeCm === null) return null;
    const units = unitsFor(this.auth.user());
    return `${fromCm(photo.sizeCm, units.length)} ${units.length}`;
  }

  private load() {
    this.api
      .get<Observation[]>(`/patients/${this.patientId}/observations`, { type: 'photo' })
      .subscribe({
        next: (res) => {
          this.photos.set(collectPhotoItems(res));
          this.error.set(null);
          this.loaded.set(true);
        },
        error: (err) => {
          this.error.set(errorText(err, 'Could not load photos.'));
          this.loaded.set(true);
        },
      });
  }
}
