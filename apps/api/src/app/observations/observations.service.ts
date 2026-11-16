import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodesEventsPivot,
  observationEntries,
  observations,
  patients,
} from '../../db/schema';
import { CreateObservationDto } from './dto/create-observation.dto';
import { UpdateObservationDto } from './dto/update-observation.dto';
import { EpisodesService } from '../episodes/episodes.service';
import { AdvisoriesService } from '../advisories/advisories.service';
import { RevisionsService } from '../revisions/revisions.service';
import { FilesService } from '../files/files.service';
import { AnalytesService } from '../analytes/analytes.service';
import { normalizeTs, toDate } from '../persistence/time';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly episodesService: EpisodesService,
    private readonly advisoriesService: AdvisoriesService,
    private readonly revisionsService: RevisionsService,
    private readonly filesService: FilesService,
    private readonly analytesService: AnalytesService,
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

  private mapObservation(row: any, entries: any[], episodeIds: string[] = [], resolvesEpisodeIds: string[] = []) {
    const observedAt = normalizeTs(row.observedAt);
    return {
      id: row.id,
      patientId: row.patientId,
      recordedByUserId: row.recordedByUserId,
      observedAt,
      text: row.text,
      episodeIds,
      resolvesEpisodeIds,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      unitPreferenceAtEntry: row.unitPreferenceAtEntry ? JSON.parse(row.unitPreferenceAtEntry) : null,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  // Weight entries denormalize onto patients.latestWeightKg/latestWeightRecordedAt so the
  // patient row always answers "how much does she weigh" without joining observations. Guarded
  // by recency on create: a backdated weight must never regress the denormalized value. A
  // correction recomputes from scratch instead (recomputeLatestWeight), since "only if newer"
  // cannot express a removal.
  private async applyLatestWeightIfNewer(patientId: string, kg: number, observedAtTs: number) {
    const db = this.db.db as any;
    const rows = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    const current = rows[0];
    const currentRecordedAt = normalizeTs(current?.latestWeightRecordedAt);
    if (currentRecordedAt !== null && observedAtTs < currentRecordedAt) {
      return;
    }
    await db
      .update(patients)
      .set({ latestWeightKg: kg, latestWeightRecordedAt: new Date(observedAtTs * 1000) })
      .where(eq(patients.id, patientId));
  }

  // Service-level, not a DTO constraint: EntryMetadataConstraint is synchronous and has no DI, so
  // it can only check the UUID's shape. Must run before the observation row is inserted, or a
  // rejected file entry leaves an orphan observation behind.
  private static readonly FILE_ENTRY_CODES: Record<string, string> = {
    photo: 'PHOTO_FILE_NOT_FOUND',
    document: 'DOCUMENT_FILE_NOT_FOUND',
  };

  private async assertEntryFilesUsable(
    entries: Array<{ type: string; metadata?: Record<string, any> }> | undefined,
    patientId: string,
    userId: string,
  ) {
    for (const entry of entries ?? []) {
      const code = ObservationsService.FILE_ENTRY_CODES[entry.type];
      if (!code) continue;
      const fileId = entry.metadata?.fileId;
      if (typeof fileId !== 'string') continue; // shape is the DTO's job
      await this.filesService.assertUsableForPatient(fileId, patientId, userId, code);
    }
  }

  // Same reason and timing as assertEntryFilesUsable: a lab_result naming an analyte that doesn't
  // exist can never be read against a reference range or trended, and catching it after the
  // observation row is inserted would leave an orphan behind.
  private async assertEntryAnalytesExist(entries: Array<{ type: string; metadata?: Record<string, any> }> | undefined) {
    for (const entry of entries ?? []) {
      if (entry.type !== 'lab_result') continue;
      const analyteId = entry.metadata?.analyteId;
      if (typeof analyteId !== 'string') continue; // shape is the DTO's job
      await this.analytesService.assertExists(analyteId);
    }
  }

  /**
   * Attach `labContext` to lab_result entries: the analyte's display name, the reference range in
   * effect at each observation's own observedAt, and this patient's goal (data-model.md → "Lab
   * result read-time context").
   *
   * A sibling of `metadata`, never merged into it — update() re-inserts entries from the DTO a
   * client echoes back, and a merged field would fail the entry schema on the round trip. One
   * batched catalog read per call, in the shape of TimelineService.medicationNames rather than a
   * lookup per entry.
   */
  private async hydrateLabContext(mapped: Array<{ patientId: string; observedAt: number | null; entries: any[] }>) {
    const analyteIds: string[] = [];
    for (const obs of mapped) {
      for (const entry of obs.entries) {
        if (entry.type === 'lab_result' && typeof entry.metadata?.analyteId === 'string') {
          analyteIds.push(entry.metadata.analyteId);
        }
      }
    }
    if (!analyteIds.length) return mapped;

    // Every observation in one response belongs to one patient (list is patient-scoped, getById
    // returns one), so a single range lookup covers them all.
    const sources = await this.analytesService.labContextSources(mapped[0].patientId, analyteIds);
    for (const obs of mapped) {
      for (const entry of obs.entries) {
        if (entry.type !== 'lab_result') continue;
        const source = sources.get(entry.metadata?.analyteId);
        if (!source) continue; // deleted analyte: no context rather than a broken read
        entry.labContext = {
          displayName: source.displayName,
          ranges: AnalytesService.resolveLineagesAt(source.ranges, obs.observedAt ?? 0).map((r) =>
            AnalytesService.rangeContext(r),
          ),
        };
      }
    }
    return mapped;
  }

  async create(patientId: string, userId: string, dto: CreateObservationDto) {
    await this.ensurePatientAccess(patientId, userId);
    if (!dto.entries || !dto.entries.length) {
      throw new BadRequestException('AT_LEAST_ONE_ENTRY_REQUIRED');
    }
    await this.assertEntryFilesUsable(dto.entries, patientId, userId);
    await this.assertEntryAnalytesExist(dto.entries);
    const db = this.db.db as any;
    const id = randomUUID();
    const observedAtDate = new Date(dto.observedAt);
    const observedAtTs = Math.floor(observedAtDate.getTime() / 1000);

    await db.insert(observations).values({
      id,
      patientId,
      recordedByUserId: userId,
      observedAt: observedAtDate,
      text: dto.text,
      // Set once at create and never touched by update() — it records the units the original
      // recorder was working in, which a later correction doesn't change (api.md → Observations).
      unitPreferenceAtEntry: dto.unitPreferenceAtEntry ? JSON.stringify(dto.unitPreferenceAtEntry) : null,
    });

    const episodeIds = new Set<string>(dto.episodeIds || []);
    let startedEpisodeId: string | null = null;
    if (dto.startEpisodeName) {
      startedEpisodeId = await this.episodesService.createFromEvent({
        patientId,
        userId,
        name: dto.startEpisodeName,
        startedAtType: 'observation',
        startedAtId: id,
        conditionId: dto.startEpisodeConditionId,
      });
      episodeIds.add(startedEpisodeId);
    }

    // The episode a startEpisodeName just created trivially belongs to this patient; the ids the
    // client sent do not, until checked.
    await this.episodesService.assertEpisodesBelongToPatient(patientId, userId, dto.episodeIds ?? []);
    this.episodesService.assertResolvesSubset(dto.resolvesEpisodeIds, Array.from(episodeIds));

    for (const entry of dto.entries) {
      await db.insert(observationEntries).values({
        id: randomUUID(),
        observationId: id,
        type: entry.type,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      });

      if (entry.type === 'weight' && entry.metadata?.kg !== undefined) {
        await this.applyLatestWeightIfNewer(patientId, entry.metadata.kg, observedAtTs);
      }
    }

    for (const ep of episodeIds) {
      await db.insert(episodesEventsPivot).values({
        id: randomUUID(),
        episodeId: ep,
        eventType: 'observation',
        eventId: id,
        startsEpisode: startedEpisodeId === ep,
        resolvesEpisode: false,
      });
    }

    if (dto.resolvesEpisodeIds && dto.resolvesEpisodeIds.length) {
      await this.episodesService.resolveEpisodes(patientId, userId, dto.resolvesEpisodeIds, 'observation', id);
      for (const ep of dto.resolvesEpisodeIds) {
        await db.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId: ep,
          eventType: 'observation',
          eventId: id,
          startsEpisode: false,
          resolvesEpisode: true,
        });
      }
    }

    const firedAdvisories = await this.advisoriesService.evaluateProtocols(
      patientId,
      userId,
      id,
      dto.entries,
    );
    const observation = await this.getById(id, userId);
    return firedAdvisories.length ? { ...observation, firedAdvisories } : observation;
  }

  async list(
    patientId: string,
    userId: string,
    params: { type?: string; from?: number; to?: number; sinceCreatedAt?: number; limit?: number; episodeId?: string },
  ) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.patientId, patientId))
      .orderBy(desc(observations.observedAt));

    const filtered = rows.filter((row: any) => {
      const ts = normalizeTs(row.observedAt);
      if (params.from && ts < params.from) return false;
      if (params.to && ts > params.to) return false;
      // Opt-in, and a *different axis* from from/to: "what have I not seen" is a question about
      // when the row was written, not about when it clinically happened. Only What's-New passes it
      // (see whats-new-window.ts); every other caller keeps clinical-time from/to untouched.
      if (params.sinceCreatedAt) {
        const created = normalizeTs(row.createdAt);
        if (created === null || created < params.sinceCreatedAt) return false;
      }
      return true;
    });

    const ids = filtered.map((r: any) => r.id);
    let entries: any[] = [];
    if (ids.length) {
      entries = await db.select().from(observationEntries).where(inArray(observationEntries.observationId, ids));
    }

    const byObs: Record<string, any[]> = {};
    for (const e of entries) {
      if (!byObs[e.observationId]) byObs[e.observationId] = [];
      byObs[e.observationId].push(e);
    }

    const pivots = ids.length
      ? await db
          .select()
          .from(episodesEventsPivot)
          .where(and(inArray(episodesEventsPivot.eventId, ids), eq(episodesEventsPivot.eventType, 'observation')))
      : [];
    const epByEvent: Record<string, { ep: string[]; res: string[] }> = {};
    for (const p of pivots) {
      if (!epByEvent[p.eventId]) epByEvent[p.eventId] = { ep: [], res: [] };
      epByEvent[p.eventId].ep.push(p.episodeId);
      if (p.resolvesEpisode) epByEvent[p.eventId].res.push(p.episodeId);
    }

    let result = filtered.map((row: any) =>
      this.mapObservation(row, byObs[row.id] || [], epByEvent[row.id]?.ep || [], epByEvent[row.id]?.res || []),
    );
    if (params.episodeId) {
      result = result.filter((obs) => obs.episodeIds.includes(params.episodeId!));
    }
    if (params.type) {
      result = result.filter((obs) => obs.entries.some((e) => e.type === params.type));
    }
    if (params.limit && result.length > params.limit) {
      result = result.slice(0, params.limit);
    }
    // After the filters and the limit: no point hydrating rows about to be dropped.
    await this.hydrateLabContext(result);
    return result;
  }

  async getById(id: string, userId: string, patientId?: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const row = rows[0];
    if (patientId && row.patientId !== patientId) {
      throw new NotFoundException('OBSERVATION_NOT_FOUND');
    }
    await this.ensurePatientAccess(row.patientId, userId);

    const entries = await db.select().from(observationEntries).where(eq(observationEntries.observationId, id));
    const pivots = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'observation')));
    const episodeIds = pivots.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId);
    const resolvesEpisodeIds = pivots.filter((p: any) => !!p.resolvesEpisode).map((p: any) => p.episodeId);
    const mapped = this.mapObservation(row, entries, episodeIds, resolvesEpisodeIds);
    await this.hydrateLabContext([mapped]);
    return mapped;
  }

  /**
   * `PATCH /api/observations/:id` — a correction (api.md → that section; data-model.md → "Data
   * integrity rules" → Corrections). Any care team member, any observation, no time limit.
   *
   * Two phases, because of `DatabaseService.withTransaction`'s sqlite caveat: every check and
   * every read (the revision snapshot, the episode plan, the weight recompute's input, the protocol
   * evaluation, the file and analyte checks) happens first; then one transaction holds nothing but
   * writes — revision, observation row, entries, pivot rows, episode state, the patient's latest
   * weight and any advisory. A request that fails a check has written nothing (ISSUES #39).
   *
   * The fixed fields never reach here: CorrectionFieldsInterceptor refused them on the raw body.
   */
  async update(id: string, userId: string, dto: UpdateObservationDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const row = rows[0];
    const patientId: string = row.patientId;
    await this.ensurePatientAccess(patientId, userId);

    if (dto.entries !== undefined && !dto.entries.length) {
      throw new BadRequestException('AT_LEAST_ONE_ENTRY_REQUIRED');
    }
    if (dto.entries) {
      await this.assertEntryFilesUsable(dto.entries, patientId, userId);
      await this.assertEntryAnalytesExist(dto.entries);
    }

    const observedAtDate = dto.observedAt !== undefined ? new Date(dto.observedAt) : toDate(row.observedAt)!;
    const observedAtTs = Math.floor(observedAtDate.getTime() / 1000);

    const episodePlan = await this.episodesService.planEventEpisodeCorrection({
      patientId,
      userId,
      eventType: 'observation',
      eventId: id,
      episodeIds: dto.episodeIds,
      resolvesEpisodeIds: dto.resolvesEpisodeIds,
      clinicalTime: dto.observedAt !== undefined ? observedAtTs : undefined,
    });

    const snapshot = await this.getById(id, userId);

    // An echoed entry keeps its id — but only an id this observation already has, once. Any other
    // id (a stale client, another observation's entry) gets a fresh one rather than a primary-key
    // collision or a row moved between observations.
    const existingEntryIds = new Set<string>(snapshot.entries.map((e: any) => e.id));
    const nextEntries = dto.entries?.map((entry) => {
      const keep = entry.id !== undefined && existingEntryIds.delete(entry.id);
      return {
        id: keep ? entry.id! : randomUUID(),
        type: entry.type,
        metadata: entry.metadata ?? null,
      };
    });

    // Entries or time changed: the latest weight and the protocols are re-derived from the result.
    const clinicalChange = dto.entries !== undefined || dto.observedAt !== undefined;
    const mergedEntries: Array<{ type: string; metadata?: Record<string, any> | null }> =
      nextEntries ?? snapshot.entries;
    const latestWeight = clinicalChange
      ? await this.recomputeLatestWeight(patientId, id, observedAtTs, row.createdAt, mergedEntries)
      : undefined;
    const trips = clinicalChange
      ? await this.advisoriesService.planProtocolTrips(patientId, userId, id, mergedEntries, { skipAlreadyFired: true })
      : [];

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (dto.text !== undefined) updates.text = dto.text;
    if (dto.observedAt !== undefined) updates.observedAt = observedAtDate;

    await this.db.withTransaction(async (tx: any) => {
      await this.revisionsService.capture('observation', id, snapshot, userId, tx);
      await tx.update(observations).set(updates).where(eq(observations.id, id));
      if (nextEntries) {
        await tx.delete(observationEntries).where(eq(observationEntries.observationId, id));
        for (const entry of nextEntries) {
          await tx.insert(observationEntries).values({
            id: entry.id,
            observationId: id,
            type: entry.type,
            metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          });
        }
      }
      await this.episodesService.applyEventEpisodeCorrection(tx, episodePlan);
      if (latestWeight) {
        await tx
          .update(patients)
          .set({
            latestWeightKg: latestWeight.kg,
            latestWeightRecordedAt: latestWeight.recordedAt === null ? null : new Date(latestWeight.recordedAt * 1000),
          })
          .where(eq(patients.id, patientId));
      }
      for (const trip of trips) await this.advisoriesService.create(trip, tx);
    });

    const observation = await this.getById(id, userId);
    const firedAdvisories = trips.map((trip) => this.advisoriesService.firedFromInput(trip));
    return firedAdvisories.length ? { ...observation, firedAdvisories } : observation;
  }

  /**
   * The patient's newest `weight` entry by `observedAt` once this correction lands, derived from
   * scratch (data-model.md → Patient → "Recomputed on correction"; ISSUES #34). Unlike
   * `applyLatestWeightIfNewer` it can move the value down, or to null when no weight remains.
   *
   * Reads only. Ties on `observedAt` go to the later-logged observation, and within one
   * observation to its last weight entry — what create's `>=` recency guard would have left.
   */
  private async recomputeLatestWeight(
    patientId: string,
    observationId: string,
    observedAtTs: number,
    createdAt: unknown,
    entries: Array<{ type: string; metadata?: Record<string, any> | null }>,
  ): Promise<{ kg: number | null; recordedAt: number | null }> {
    const db = this.db.db as any;
    const others = await db
      .select({
        observationId: observations.id,
        observedAt: observations.observedAt,
        createdAt: observations.createdAt,
        metadata: observationEntries.metadata,
      })
      .from(observationEntries)
      .innerJoin(observations, eq(observationEntries.observationId, observations.id))
      .where(and(eq(observations.patientId, patientId), eq(observationEntries.type, 'weight')));

    const candidates: Array<{ kg: number; at: number; created: number }> = [];
    for (const other of others) {
      if (other.observationId === observationId) continue; // replaced by `entries` below
      const kg = other.metadata ? JSON.parse(other.metadata)?.kg : undefined;
      const at = normalizeTs(other.observedAt);
      if (typeof kg !== 'number' || at === null) continue;
      candidates.push({ kg, at, created: normalizeTs(other.createdAt) ?? 0 });
    }
    const created = normalizeTs(createdAt as any) ?? 0;
    for (const entry of entries) {
      if (entry.type === 'weight' && typeof entry.metadata?.kg === 'number') {
        candidates.push({ kg: entry.metadata.kg, at: observedAtTs, created });
      }
    }

    let best: { kg: number; at: number; created: number } | null = null;
    for (const c of candidates) {
      if (!best || c.at > best.at || (c.at === best.at && c.created >= best.created)) best = c;
    }
    return best ? { kg: best.kg, recordedAt: best.at } : { kg: null, recordedAt: null };
  }

  async getRevisions(id: string, userId: string) {
    await this.getById(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('observation', id);
  }
}
