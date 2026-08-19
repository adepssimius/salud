import { Observation } from '@salud/shared/types';

// Photographed sites — the grouping every photo surface in the app shares.
//
// A photo entry's metadata carries `{ fileId, bodyLocation, side, sizeCm?, note? }`
// (data-model.md → "Observation entry structured metadata"). On its own that is a flat pile of
// images; what a caregiver actually asks is "how is *this ear drum* doing compared to Tuesday",
// so the unit of meaning is the (bodyLocation, side) site, not the individual photo. The entry
// form's framing references (frontend.md → Photos, F-8.2 v2) and the Photos page group by exactly
// the same identity, which is why the key and the label live here rather than in either page.

export type Side = 'left' | 'right' | 'bilateral' | 'n/a';

const SIDES: Side[] = ['left', 'right', 'bilateral', 'n/a'];

/** Grouping identity: location compared trimmed and case-insensitively, side exactly. */
export function photoSiteKey(bodyLocation: string, side: Side): string {
  return `${bodyLocation.trim().toLowerCase()}|${side}`;
}

/** What a site with no recorded body location is called. Defensive — the API requires one. */
export const UNSPECIFIED_SITE_LABEL = 'Unspecified site';

/**
 * "ear drum · right" — the location in the casing it was *recorded* in (grouping is
 * case-insensitive, display never is), with the side omitted when it says nothing.
 */
export function photoSiteLabel(bodyLocation: string, side: Side): string {
  const location = bodyLocation.trim() || UNSPECIFIED_SITE_LABEL;
  return side && side !== 'n/a' ? `${location} · ${side}` : location;
}

/** One photo entry, lifted out of the observation that carries it. */
export interface PhotoItem {
  observationId: string;
  fileId: string;
  /** Verbatim as recorded, trimmed; empty when the metadata had none. */
  bodyLocation: string;
  side: Side;
  /** Canonical cm, as stored — callers convert to the viewer's length preference. */
  sizeCm: number | null;
  note: string | null;
  /** Epoch seconds — the observation's `observedAt`, i.e. when the photo was taken. */
  timestamp: number;
  recordedByUserId: string;
}

/** One photographed site and its photos over time. */
export interface PhotoSite {
  key: string;
  label: string;
  bodyLocation: string;
  side: Side;
  /** Oldest → newest: a progression is read forwards in time. */
  photos: PhotoItem[];
  /** The most recent photo of this site — the group's cover image. */
  latest: PhotoItem;
  count: number;
}

function normalizeSide(value: unknown): Side {
  return SIDES.includes(value as Side) ? (value as Side) : 'n/a';
}

/**
 * Every photo entry across a list of observations, oldest first.
 *
 * Deliberately forgiving about metadata: `GET /patients/:id/observations?type=photo` returns whole
 * observations, so a multi-entry save arrives with its temperature and note entries attached, and
 * a photo whose `bodyLocation` never made it in is a row to file under "unspecified", not a reason
 * for the page to throw. Only a missing `fileId` drops the entry — there is no image to show.
 */
export function collectPhotoItems(observations: Observation[] | null | undefined): PhotoItem[] {
  const items: PhotoItem[] = [];
  for (const obs of observations ?? []) {
    for (const entry of obs?.entries ?? []) {
      if (entry?.type !== 'photo') continue;
      const metadata: any = entry.metadata ?? {};
      if (typeof metadata.fileId !== 'string' || !metadata.fileId) continue;
      items.push({
        observationId: obs.id,
        fileId: metadata.fileId,
        bodyLocation: typeof metadata.bodyLocation === 'string' ? metadata.bodyLocation.trim() : '',
        side: normalizeSide(metadata.side),
        sizeCm: typeof metadata.sizeCm === 'number' && !Number.isNaN(metadata.sizeCm) ? metadata.sizeCm : null,
        note: typeof metadata.note === 'string' && metadata.note.trim() ? metadata.note : null,
        timestamp: obs.observedAt,
        recordedByUserId: obs.recordedByUserId,
      });
    }
  }
  return items.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Photos grouped into sites, sites ordered by the recency of their latest photo — the same order
 * the entry form's framing-reference strip uses, so the two surfaces agree about which site is
 * the one currently being watched.
 */
export function groupPhotosBySite(items: PhotoItem[]): PhotoSite[] {
  const groups = new Map<string, PhotoSite>();
  // Oldest first, so each group's `photos` come out in progression order and the last write to
  // `latest` is the most recent photo.
  for (const item of [...items].sort((a, b) => a.timestamp - b.timestamp)) {
    const key = photoSiteKey(item.bodyLocation, item.side);
    const existing = groups.get(key);
    if (existing) {
      existing.photos.push(item);
      existing.count++;
      existing.latest = item;
      // The most recent photo's casing wins, matching the framing-reference rule (F-8.2 v2).
      existing.bodyLocation = item.bodyLocation;
      existing.label = photoSiteLabel(item.bodyLocation, item.side);
    } else {
      groups.set(key, {
        key,
        label: photoSiteLabel(item.bodyLocation, item.side),
        bodyLocation: item.bodyLocation,
        side: item.side,
        photos: [item],
        latest: item,
        count: 1,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.latest.timestamp - a.latest.timestamp);
}
