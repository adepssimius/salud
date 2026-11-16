import { Episode } from '@salud/shared/types';
import { EpisodeOption } from '../quick-log/episode-attachment.component';

/**
 * Shared plumbing for correcting an observation or intervention (frontend.md → "Correcting an
 * entry"). Pure functions only, so the "send only what changed" rule is testable without a
 * component around it.
 */

/** Epoch seconds → the `datetime-local` value the create forms use (local time, minute precision). */
export function toLocalDateTimeInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** What the episode section of a correction form starts from and edits. */
export interface CorrectionEpisodeState {
  /** Every episode the form offers: the patient's active ones plus whatever this entry is linked to. */
  options: EpisodeOption[];
  /** The episode this entry started, if any — shown checked and locked. */
  startedId: string | null;
  /** Membership as stored: the union of `episodeIds` and `resolvesEpisodeIds`. */
  selectedIds: string[];
  resolvesIds: string[];
}

/**
 * Builds the episode state for a stored entry. `episodeIds` and `resolvesEpisodeIds` come back
 * disjoint on read (CLAUDE.md → Episode model), and the PATCH wants `resolves ⊆ episodeIds`, so the
 * selection is their union. A resolved episode the entry belongs to is still offered — it is part
 * of what was recorded, even though create would no longer list it.
 */
export function correctionEpisodeState(
  entity: { id: string; episodeIds?: string[]; resolvesEpisodeIds?: string[] },
  kind: 'observation' | 'intervention',
  allEpisodes: Episode[],
): CorrectionEpisodeState {
  const resolvesIds = [...(entity.resolvesEpisodeIds ?? [])];
  const selectedIds = Array.from(new Set([...(entity.episodeIds ?? []), ...resolvesIds]));
  const byId = new Map(allEpisodes.map((ep) => [ep.id, ep]));
  const started = allEpisodes.find((ep) => ep.startedAtType === kind && ep.startedAtId === entity.id);
  const ids = Array.from(
    new Set([...selectedIds, ...allEpisodes.filter((ep) => ep.status === 'active').map((ep) => ep.id)]),
  );
  return {
    options: ids.map((id) => ({ id, name: byId.get(id)?.name ?? 'Episode' })),
    startedId: started && selectedIds.includes(started.id) ? started.id : null,
    selectedIds,
    resolvesIds,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * The episode part of a correction body: both lists, whole, or nothing. Sent together because the
 * API replaces each list whole and checks one against the other.
 */
export function episodeCorrection(
  original: CorrectionEpisodeState,
  current: { selectedIds: string[]; resolvesIds: string[] },
): { episodeIds: string[]; resolvesEpisodeIds: string[] } | null {
  const resolves = current.resolvesIds.filter((id) => current.selectedIds.includes(id));
  if (sameSet(original.selectedIds, current.selectedIds) && sameSet(original.resolvesIds, resolves)) {
    return null;
  }
  return { episodeIds: [...current.selectedIds], resolvesEpisodeIds: resolves };
}

/**
 * The resolve list a correction form would send. The picker's resolve control is one switch for
 * every selected episode, which cannot show a stored *partial* resolution (an entry that resolved
 * one of its episodes but not another). So until the caregiver touches that switch (`flag` null)
 * the stored resolutions are kept as they are — minus any episode since detached — and only an
 * explicit tick or untick rewrites them, the same way create applies it: every selected episode
 * except the one this entry started.
 */
export function correctionResolves(
  state: CorrectionEpisodeState,
  selectedIds: string[],
  flag: boolean | null,
): string[] {
  if (flag === null) return state.resolvesIds.filter((id) => selectedIds.includes(id));
  return flag ? selectedIds.filter((id) => id !== state.startedId) : [];
}

/** Key-order-independent JSON, dropping `undefined` the way the wire does. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(',')}}`;
}
