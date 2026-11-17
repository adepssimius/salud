import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodes,
  episodesEventsPivot,
  interventions,
  observations,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { Episode, EpisodeEventRef } from '@salud/shared/types';
import { EpisodesService, EventEpisodeCorrectionPlan } from './episodes.service';
import { ObservationsService } from '../observations/observations.service';
import { InterventionsService } from '../interventions/interventions.service';
import { RevisionsService } from '../revisions/revisions.service';
import { ConditionsService } from '../conditions/conditions.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateEpisodeEventsDto } from './dto/update-episode-events.dto';

interface LoadedEvent extends EpisodeEventRef {
  /** Clinical time (`observedAt` / `performedAt`), epoch seconds. */
  time: number;
}

const refKey = (r: EpisodeEventRef) => `${r.type}:${r.id}`;

function dedupe(refs: EpisodeEventRef[] | undefined): EpisodeEventRef[] {
  const seen = new Map<string, EpisodeEventRef>();
  for (const r of refs ?? []) seen.set(refKey(r), { type: r.type, id: r.id });
  return [...seen.values()];
}

/**
 * Episodes drawn from the episode side (api.md → Episodes; data-model.md → "Data integrity rules" →
 * Episodes drawn afterward): `POST /patients/:id/episodes` frames entries already logged, and
 * `POST /episodes/:id/events` edits membership.
 *
 * Its own service, not part of EpisodesService, because it needs the observation and intervention
 * services for revision snapshots — and both of those already depend on EpisodesService.
 *
 * Membership edits deliberately go through `planEventEpisodeCorrection` /
 * `applyEventEpisodeCorrection`, the same pair the entry PATCHes use, so the episode-side and
 * entry-side paths cannot disagree about CANNOT_UNLINK_STARTED_EPISODE, reopening, or the
 * resolve-subset rule. Same two-phase shape too: every read first, then one transaction of writes
 * (the sqlite caveat on `DatabaseService.withTransaction`).
 */
@Injectable()
export class EpisodeFramingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly episodesService: EpisodesService,
    private readonly observationsService: ObservationsService,
    private readonly interventionsService: InterventionsService,
    private readonly revisionsService: RevisionsService,
    private readonly conditionsService: ConditionsService,
  ) {}

  private async ensurePatientAccess(patientId: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (!rows.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }
  }

  /** Every ref must name an existing entry of this patient — 404 EPISODE_EVENT_NOT_FOUND otherwise. */
  private async loadEvents(patientId: string, refs: EpisodeEventRef[]): Promise<LoadedEvent[]> {
    const db = this.db.db as any;
    const obsIds = refs.filter((r) => r.type === 'observation').map((r) => r.id);
    const intIds = refs.filter((r) => r.type === 'intervention').map((r) => r.id);
    const obsRows = obsIds.length
      ? await db
          .select({ id: observations.id, at: observations.observedAt })
          .from(observations)
          .where(and(eq(observations.patientId, patientId), inArray(observations.id, obsIds)))
      : [];
    const intRows = intIds.length
      ? await db
          .select({ id: interventions.id, at: interventions.performedAt })
          .from(interventions)
          .where(and(eq(interventions.patientId, patientId), inArray(interventions.id, intIds)))
      : [];
    if (obsRows.length !== obsIds.length || intRows.length !== intIds.length) {
      throw new NotFoundException('EPISODE_EVENT_NOT_FOUND');
    }
    return [
      ...obsRows.map((r: any) => ({ type: 'observation' as const, id: r.id, time: normalizeTs(r.at)! })),
      ...intRows.map((r: any) => ({ type: 'intervention' as const, id: r.id, time: normalizeTs(r.at)! })),
    ];
  }

  /** The revision snapshot: the entry's prior state in its own GET shape (data-model.md → Revision). */
  private async snapshot(ref: EpisodeEventRef, userId: string): Promise<Record<string, any>> {
    return ref.type === 'observation'
      ? await this.observationsService.getById(ref.id, userId)
      : await this.interventionsService.get(ref.id, userId);
  }

  private entityTable(type: EpisodeEventRef['type']) {
    return type === 'observation' ? observations : interventions;
  }

  async create(patientId: string, userId: string, dto: CreateEpisodeDto): Promise<Episode> {
    await this.ensurePatientAccess(patientId, userId);
    const refs = dedupe(dto.events);
    if (!refs.length) throw new BadRequestException('EPISODE_EVENTS_REQUIRED');

    const loaded = await this.loadEvents(patientId, refs);
    const resolvedBy = dto.resolvedBy ? { type: dto.resolvedBy.type, id: dto.resolvedBy.id } : null;
    if (resolvedBy && !refs.some((r) => refKey(r) === refKey(resolvedBy))) {
      throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
    }
    if (dto.conditionId) {
      const condition = await this.conditionsService.getAuthorizedCondition(dto.conditionId, userId);
      if (condition.patientId !== patientId) throw new NotFoundException('CONDITION_NOT_FOUND');
    }

    // The start is the earliest selected entry; ties go observation-first, then by id, so the
    // choice is deterministic. Since the start is the earliest, `resolvedBy` can never precede it.
    const start = [...loaded].sort(
      (a, b) =>
        a.time - b.time ||
        (a.type === b.type ? 0 : a.type === 'observation' ? -1 : 1) ||
        a.id.localeCompare(b.id),
    )[0];

    const snapshots = await Promise.all(refs.map(async (r) => ({ ref: r, snap: await this.snapshot(r, userId) })));
    const episodeId = randomUUID();
    const now = new Date();

    await this.db.withTransaction(async (tx: any) => {
      await tx.insert(episodes).values({
        id: episodeId,
        patientId,
        conditionId: dto.conditionId ?? null,
        name: dto.name.trim(),
        startedAtType: start.type,
        startedAtId: start.id,
        endedAtType: resolvedBy?.type ?? null,
        endedAtId: resolvedBy?.id ?? null,
        status: resolvedBy ? 'resolved' : 'active',
        notes: dto.notes ?? null,
      });
      for (const { ref, snap } of snapshots) {
        await this.revisionsService.capture(ref.type, ref.id, snap, userId, tx);
        await tx
          .update(this.entityTable(ref.type))
          .set({ updatedAt: now })
          .where(eq(this.entityTable(ref.type).id, ref.id));
        // The established pivot pattern (CLAUDE.md → Episode model): a membership row carrying
        // `startsEpisode`, and a SEPARATE row for a resolving link.
        await tx.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId,
          eventType: ref.type,
          eventId: ref.id,
          startsEpisode: ref.type === start.type && ref.id === start.id,
          resolvesEpisode: false,
        });
        if (resolvedBy && refKey(resolvedBy) === refKey(ref)) {
          await tx.insert(episodesEventsPivot).values({
            id: randomUUID(),
            episodeId,
            eventType: ref.type,
            eventId: ref.id,
            startsEpisode: false,
            resolvesEpisode: true,
          });
        }
      }
    });

    return this.episodesService.getById(episodeId, userId);
  }

  async updateEvents(episodeId: string, userId: string, dto: UpdateEpisodeEventsDto): Promise<Episode> {
    // getById 404s EPISODE_NOT_FOUND before it can disclose anything, then checks access.
    const episode = await this.episodesService.getById(episodeId, userId);
    const patientId = episode.patientId;
    await this.ensurePatientAccess(patientId, userId);

    const removeKeys = new Set(dedupe(dto.remove).map(refKey));
    // An entry named in both lists is ambiguous; it is left as it is.
    const add = dedupe(dto.add).filter((r) => !removeKeys.has(refKey(r)));
    const addKeys = new Set(dedupe(dto.add).map(refKey));
    const remove = dedupe(dto.remove).filter((r) => !addKeys.has(refKey(r)));
    if (!dto.add?.length && !dto.remove?.length) throw new BadRequestException('EPISODE_EVENTS_REQUIRED');

    await this.loadEvents(patientId, [...add, ...remove]);

    const db = this.db.db as any;
    const work: Array<{ ref: EpisodeEventRef; plan: EventEpisodeCorrectionPlan; snap: Record<string, any> }> = [];
    for (const [ref, adding] of [...add.map((r) => [r, true] as const), ...remove.map((r) => [r, false] as const)]) {
      const pivots = await db
        .select()
        .from(episodesEventsPivot)
        .where(and(eq(episodesEventsPivot.eventId, ref.id), eq(episodesEventsPivot.eventType, ref.type)));
      const memberOf: string[] = Array.from(new Set(pivots.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId)));
      const resolves: string[] = Array.from(new Set(pivots.filter((p: any) => p.resolvesEpisode).map((p: any) => p.episodeId)));

      let episodeIds: string[];
      let resolvesEpisodeIds: string[] | undefined;
      if (adding) {
        if (memberOf.includes(episodeId)) continue;
        episodeIds = [...memberOf, episodeId];
      } else {
        if (!memberOf.includes(episodeId) && !resolves.includes(episodeId)) continue;
        episodeIds = memberOf.filter((id) => id !== episodeId);
        // Only sent when it changes, exactly as an entry PATCH that leaves resolves alone: sending
        // it would re-run the time-order check on this entry's *other* episodes for no reason.
        resolvesEpisodeIds = resolves.includes(episodeId) ? resolves.filter((id) => id !== episodeId) : undefined;
      }

      const plan = await this.episodesService.planEventEpisodeCorrection({
        patientId,
        userId,
        eventType: ref.type,
        eventId: ref.id,
        episodeIds,
        resolvesEpisodeIds,
      });
      work.push({ ref, plan, snap: await this.snapshot(ref, userId) });
    }

    if (work.length) {
      const now = new Date();
      await this.db.withTransaction(async (tx: any) => {
        for (const { ref, plan, snap } of work) {
          await this.revisionsService.capture(ref.type, ref.id, snap, userId, tx);
          await tx
            .update(this.entityTable(ref.type))
            .set({ updatedAt: now })
            .where(eq(this.entityTable(ref.type).id, ref.id));
          await this.episodesService.applyEventEpisodeCorrection(tx, plan);
        }
      });
    }

    return this.episodesService.getById(episodeId, userId);
  }
}
