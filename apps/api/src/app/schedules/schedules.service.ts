import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { careTeamMemberships, interventionSchedules, interventions } from '../../db/schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { LogScheduleDto } from './dto/log-schedule.dto';
import { UpdateScheduleDosesDto } from './dto/update-schedule-doses.dto';
import { RevisionsService } from '../revisions/revisions.service';
import { ScheduleDose, ScheduleDosesResponse } from '@salud/shared/types';
import { InterventionsService } from '../interventions/interventions.service';
import { CreateInterventionDto } from '../interventions/dto/create-intervention.dto';
import { normalizeTs, toDate } from '../persistence/time';
import { nextExplicitTime, scheduleLoggedCount, toScheduleView } from './schedule-view';
import { isValidTimeZone } from './zoned-time';

interface TimingConfig {
  frequencyHours: number | null;
  explicitTimes: string[] | null;
  // The zone explicitTimes are wall-clock times in. Null only on rows that predate the column,
  // which keep the server-clock reading they always had (data-model.md → InterventionSchedule).
  timeZone: string | null;
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly interventionsService: InterventionsService,
    private readonly revisionsService: RevisionsService,
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

  private computeNextDueAt(timing: TimingConfig, from: Date, strictlyAfter: boolean): Date | null {
    if (timing.frequencyHours) {
      const base = strictlyAfter ? from.getTime() : from.getTime();
      const offsetMs = strictlyAfter ? timing.frequencyHours * 3600_000 : 0;
      return new Date(base + offsetMs);
    }
    if (timing.explicitTimes && timing.explicitTimes.length) {
      return nextExplicitTime(timing.explicitTimes, from, strictlyAfter, timing.timeZone);
    }
    return null;
  }

  private applyEndConditions(
    row: { endAfterOccurrences: number | null; endAt: any },
    nextDueAt: Date | null,
    loggedCount: number,
  ): { nextDueAt: Date | null; completed: boolean } {
    if (row.endAfterOccurrences != null && loggedCount >= row.endAfterOccurrences) {
      return { nextDueAt: null, completed: true };
    }
    const endAtTs = normalizeTs(row.endAt);
    if (nextDueAt && endAtTs != null && Math.floor(nextDueAt.getTime() / 1000) > endAtTs) {
      return { nextDueAt: null, completed: true };
    }
    return { nextDueAt, completed: false };
  }

  private async loggedCount(scheduleId: string): Promise<number> {
    return scheduleLoggedCount(this.db.db as any, scheduleId);
  }

  private async pickSchedule(row: any) {
    return toScheduleView(this.db.db as any, row);
  }

  async create(patientId: string, userId: string, dto: CreateScheduleDto) {
    await this.ensurePatientAccess(patientId, userId);

    if (dto.type === 'medication_dose' && !dto.medicationId) {
      throw new BadRequestException('MEDICATION_ID_REQUIRED');
    }
    if (dto.type === 'dressing_change' && !dto.bodyLocation) {
      throw new BadRequestException('BODY_LOCATION_REQUIRED');
    }
    if (!dto.frequencyHours && !dto.explicitTimes) {
      throw new BadRequestException('FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED');
    }
    if (dto.episodeId && dto.conditionId) {
      throw new BadRequestException('SCHEDULE_EPISODE_CONDITION_CONFLICT');
    }
    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException('INVALID_TIME_ZONE');
    }

    const db = this.db.db as any;
    const id = randomUUID();
    const startAtDate = new Date(dto.startAt);
    const timing: TimingConfig = {
      frequencyHours: dto.frequencyHours ?? null,
      explicitTimes: dto.explicitTimes ?? null,
      timeZone: dto.timeZone ?? null,
    };
    const initialNextDueAt = this.computeNextDueAt(timing, startAtDate, false);

    await db.insert(interventionSchedules).values({
      id,
      patientId,
      type: dto.type,
      medicationId: dto.medicationId ?? null,
      medicationEmbodimentId: dto.medicationEmbodimentId ?? null,
      episodeId: dto.episodeId ?? null,
      conditionId: dto.conditionId ?? null,
      label: dto.label,
      doseMg: dto.doseMg ?? null,
      doseMl: dto.doseMl ?? null,
      pillCount: dto.pillCount ?? null,
      bodyLocation: dto.bodyLocation ?? null,
      side: dto.side ?? null,
      dressingType: dto.dressingType ?? null,
      frequencyHours: dto.frequencyHours ?? null,
      explicitTimes: dto.explicitTimes ? JSON.stringify(dto.explicitTimes) : null,
      timeZone: dto.timeZone ?? null,
      startAt: startAtDate,
      endAfterOccurrences: dto.endAfterOccurrences ?? null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      notes: dto.notes ?? null,
      status: 'active',
      nextDueAt: initialNextDueAt,
      createdByUserId: userId,
    });

    return this.get(id, userId);
  }

  async listForPatient(
    patientId: string,
    userId: string,
    params: { type?: string; status?: string; episodeId?: string },
  ) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    let rows = await db
      .select()
      .from(interventionSchedules)
      .where(eq(interventionSchedules.patientId, patientId));

    if (params.type) rows = rows.filter((r: any) => r.type === params.type);
    if (params.status) rows = rows.filter((r: any) => r.status === params.status);
    if (params.episodeId) rows = rows.filter((r: any) => r.episodeId === params.episodeId);

    return Promise.all(rows.map((r: any) => this.pickSchedule(r)));
  }

  private async getRow(id: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(interventionSchedules).where(eq(interventionSchedules.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('SCHEDULE_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);
    return row;
  }

  async get(id: string, userId: string) {
    const row = await this.getRow(id, userId);
    return this.pickSchedule(row);
  }

  async update(id: string, userId: string, dto: UpdateScheduleDto) {
    const row = await this.getRow(id, userId);
    const db = this.db.db as any;

    const resolvedEpisodeId = dto.episodeId !== undefined ? dto.episodeId : row.episodeId;
    const resolvedConditionId = dto.conditionId !== undefined ? dto.conditionId : row.conditionId;
    if (resolvedEpisodeId && resolvedConditionId) {
      throw new BadRequestException('SCHEDULE_EPISODE_CONDITION_CONFLICT');
    }
    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException('INVALID_TIME_ZONE');
    }

    const updates: Record<string, any> = {};
    const directFields = [
      'label',
      'medicationId',
      'medicationEmbodimentId',
      'doseMg',
      'doseMl',
      'pillCount',
      'bodyLocation',
      'side',
      'dressingType',
      'endAfterOccurrences',
      'notes',
      'status',
    ] as const;
    for (const key of directFields) {
      if (dto[key] !== undefined) updates[key] = dto[key];
    }
    if (dto.episodeId !== undefined) updates.episodeId = dto.episodeId;
    if (dto.conditionId !== undefined) updates.conditionId = dto.conditionId;
    if (dto.frequencyHours !== undefined) updates.frequencyHours = dto.frequencyHours;
    if (dto.explicitTimes !== undefined) updates.explicitTimes = JSON.stringify(dto.explicitTimes);
    if (dto.timeZone !== undefined) updates.timeZone = dto.timeZone;
    if (dto.endAt !== undefined) updates.endAt = dto.endAt ? new Date(dto.endAt) : null;

    const timingChanged =
      dto.frequencyHours !== undefined ||
      dto.explicitTimes !== undefined ||
      dto.timeZone !== undefined ||
      dto.status !== undefined;

    if (timingChanged) {
      const newStatus = dto.status ?? row.status;
      if (newStatus === 'paused' || newStatus === 'completed') {
        updates.nextDueAt = null;
      } else {
        const timing: TimingConfig = {
          frequencyHours: dto.frequencyHours !== undefined ? dto.frequencyHours : row.frequencyHours,
          explicitTimes:
            dto.explicitTimes !== undefined ? dto.explicitTimes : row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
          timeZone: dto.timeZone !== undefined ? dto.timeZone : row.timeZone ?? null,
        };
        const loggedCount = await this.loggedCount(id);
        let base: Date;
        let strictlyAfter: boolean;
        if (loggedCount > 0) {
          const lastDoseRows = await db
            .select()
            .from(interventions)
            .where(eq(interventions.scheduleId, id));
          const lastPerformedAtTs = Math.max(...lastDoseRows.map((r: any) => normalizeTs(r.performedAt) ?? 0));
          base = new Date(lastPerformedAtTs * 1000);
          strictlyAfter = true;
        } else {
          base = toDate(row.startAt)!;
          strictlyAfter = false;
        }
        const next = this.computeNextDueAt(timing, base, strictlyAfter);
        const { nextDueAt, completed } = this.applyEndConditions(
          { endAfterOccurrences: dto.endAfterOccurrences ?? row.endAfterOccurrences, endAt: updates.endAt !== undefined ? updates.endAt : row.endAt },
          next,
          loggedCount,
        );
        updates.nextDueAt = nextDueAt;
        if (completed) updates.status = 'completed';
      }
    }

    if (Object.keys(updates).length) {
      await db.update(interventionSchedules).set(updates).where(eq(interventionSchedules.id, id));
    }

    return this.get(id, userId);
  }

  async log(id: string, userId: string, dto: LogScheduleDto) {
    const row = await this.getRow(id, userId);
    const db = this.db.db as any;

    const performedAtDate = dto.performedAt ? new Date(dto.performedAt) : new Date();

    const interventionDto: CreateInterventionDto = {
      performedAt: performedAtDate.toISOString(),
      type: row.type,
      episodeIds: row.episodeId ? [row.episodeId] : undefined,
      notes: dto.notes,
      interventionScheduleId: id,
    };
    if (row.type === 'medication_dose') {
      Object.assign(interventionDto, {
        medicationId: row.medicationId,
        medicationEmbodimentId: row.medicationEmbodimentId ?? undefined,
        // 'schedule', not 'override': a dose given exactly as the schedule specifies is the most
        // plan-conforming dose there is, and labelling it an override misreads it in the ER Brief
        // (api.md -> Intervention schedules). Provenance only: the atypical checks judge the
        // amount and time, so a scheduled dose is checked like any other.
        doseSource: 'schedule' as const,
        amountMg: row.doseMg ?? undefined,
        amountMl: row.doseMl ?? undefined,
        pillCount: row.pillCount ?? undefined,
      });
    } else {
      Object.assign(interventionDto, {
        bodyLocation: row.bodyLocation ?? undefined,
        side: row.side ?? undefined,
        dressingType: row.dressingType ?? undefined,
      });
    }

    const created = await this.interventionsService.create(row.patientId, userId, interventionDto);

    // Advance nextDueAt forward from this occurrence.
    const timing: TimingConfig = {
      frequencyHours: row.frequencyHours,
      explicitTimes: row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
      timeZone: row.timeZone ?? null,
    };
    const loggedCount = await this.loggedCount(id);
    const next = this.computeNextDueAt(timing, performedAtDate, true);
    const { nextDueAt, completed } = this.applyEndConditions(row, next, loggedCount);

    await db
      .update(interventionSchedules)
      .set({ nextDueAt, status: completed ? 'completed' : row.status })
      .where(eq(interventionSchedules.id, id));

    return { intervention: created, schedule: await this.get(id, userId) };
  }

  // ── Linking existing doses (api.md → Intervention schedules → "Linking existing doses") ──────

  private toScheduleDose(row: any): ScheduleDose {
    const m = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      interventionId: row.id,
      performedAt: normalizeTs(row.performedAt)!,
      medicationEmbodimentId: m.medicationEmbodimentId ?? null,
      amountMg: m.amountMg ?? null,
      amountMl: m.amountMl ?? null,
      pillCount: m.pillCount ?? null,
      doseSource: m.doseSource ?? null,
      recordedByUserId: row.recordedByUserId,
      linkedLater: m.scheduleLinked === true,
    };
  }

  /**
   * Whether an intervention row could be linked to this schedule: no schedule yet, the schedule's
   * type, its medicine (and its embodiment, when the schedule names one), and performed inside the
   * schedule's window — `startAt` to `endAt`, or open-ended.
   */
  private isCandidate(schedule: any, row: any): boolean {
    if (row.patientId !== schedule.patientId || row.scheduleId || row.type !== schedule.type) return false;
    const m = row.metadata ? JSON.parse(row.metadata) : {};
    if (schedule.type === 'medication_dose') {
      if (m.medicationId !== schedule.medicationId) return false;
      if (schedule.medicationEmbodimentId && m.medicationEmbodimentId !== schedule.medicationEmbodimentId) return false;
    }
    const at = normalizeTs(row.performedAt)!;
    const start = normalizeTs(schedule.startAt)!;
    const end = normalizeTs(schedule.endAt);
    return at >= start && (end == null || at <= end);
  }

  private async dosesFor(schedule: any): Promise<{ linked: ScheduleDose[]; candidates: ScheduleDose[] }> {
    const db = this.db.db as any;
    const rows: any[] = await db.select().from(interventions).where(eq(interventions.patientId, schedule.patientId));
    const newestFirst = (a: ScheduleDose, b: ScheduleDose) => b.performedAt - a.performedAt;
    return {
      linked: rows.filter((r) => r.scheduleId === schedule.id).map((r) => this.toScheduleDose(r)).sort(newestFirst),
      candidates: rows.filter((r) => this.isCandidate(schedule, r)).map((r) => this.toScheduleDose(r)).sort(newestFirst),
    };
  }

  async doses(id: string, userId: string): Promise<ScheduleDosesResponse> {
    const row = await this.getRow(id, userId);
    return { schedule: await this.pickSchedule(row), ...(await this.dosesFor(row)) };
  }

  /**
   * Attach doses logged ad hoc to this schedule, or detach ones attached that way. Each changed
   * dose gets a Revision (its prior state), `doseSource` is left as it was, and a service-owned
   * `scheduleLinked` flag marks the link as made after the fact — the only links that can be
   * undone; a dose logged *from* the schedule stays its own. Then `nextDueAt` and status are
   * recomputed exactly as a timing PATCH does: from the schedule's latest dose. All in one
   * transaction — a request that fails any check writes nothing.
   */
  async updateDoses(id: string, userId: string, dto: UpdateScheduleDosesDto): Promise<ScheduleDosesResponse> {
    const row = await this.getRow(id, userId);
    const db = this.db.db as any;
    const link = [...new Set(dto.link ?? [])];
    const unlink = [...new Set(dto.unlink ?? [])];
    // Nothing to do, or the same dose asked to be both linked and unlinked.
    if ((!link.length && !unlink.length) || link.some((i) => unlink.includes(i))) {
      throw new BadRequestException('SCHEDULE_DOSES_INVALID');
    }

    const ids = [...link, ...unlink];
    const found: any[] = await db.select().from(interventions).where(inArray(interventions.id, ids));
    const byId = new Map(found.map((r) => [r.id, r]));
    // Another patient's dose is reported as not found, never as "not linkable" (no existence leak).
    const missing = ids.filter((i) => !byId.has(i) || byId.get(i).patientId !== row.patientId);
    if (missing.length) throw new NotFoundException({ message: 'INTERVENTION_NOT_FOUND', interventionIds: missing });

    const toLink = link.filter((i) => byId.get(i).scheduleId !== id); // already linked: no-op
    const notLinkable = toLink.filter((i) => !this.isCandidate(row, byId.get(i)));
    if (notLinkable.length) throw new BadRequestException({ message: 'DOSE_NOT_LINKABLE', interventionIds: notLinkable });

    const toUnlink = unlink.filter((i) => byId.get(i).scheduleId === id); // not linked here: no-op
    const notUnlinkable = toUnlink.filter((i) => {
      const m = byId.get(i).metadata ? JSON.parse(byId.get(i).metadata) : {};
      return m.scheduleLinked !== true;
    });
    if (notUnlinkable.length) throw new BadRequestException({ message: 'DOSE_NOT_UNLINKABLE', interventionIds: notUnlinkable });

    // Snapshots before the transaction opens (RevisionsService.capture's contract).
    const changed = [...toLink, ...toUnlink];
    const snapshots = new Map<string, any>();
    for (const i of changed) snapshots.set(i, await this.interventionsService.get(i, userId));

    await this.db.withTransaction(async (tx: any) => {
      for (const i of changed) {
        const r = byId.get(i);
        const m = r.metadata ? JSON.parse(r.metadata) : {};
        const linking = toLink.includes(i);
        if (linking) {
          m.interventionScheduleId = id;
          m.scheduleLinked = true;
        } else {
          m.interventionScheduleId = null;
          delete m.scheduleLinked;
        }
        await this.revisionsService.capture('intervention', i, snapshots.get(i), userId, tx);
        await tx
          .update(interventions)
          .set({ scheduleId: linking ? id : null, metadata: JSON.stringify(m), updatedAt: new Date() })
          .where(eq(interventions.id, i));
      }
      if (changed.length) await this.recomputeAfterDoseChange(tx, row);
    });

    return this.doses(id, userId);
  }

  /**
   * After the set of doses on a schedule changes: an active schedule's `nextDueAt` follows its
   * latest dose (or `startAt` with none), and reaching `endAfterOccurrences` / passing `endAt`
   * completes it — the same rules as a timing PATCH. A paused or completed schedule is left as
   * the caregiver set it.
   */
  private async recomputeAfterDoseChange(tx: any, row: any) {
    if (row.status !== 'active') return;
    const doses: any[] = await tx.select().from(interventions).where(eq(interventions.scheduleId, row.id));
    const timing: TimingConfig = {
      frequencyHours: row.frequencyHours,
      explicitTimes: row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
      timeZone: row.timeZone ?? null,
    };
    const next = doses.length
      ? this.computeNextDueAt(timing, new Date(Math.max(...doses.map((d) => normalizeTs(d.performedAt) ?? 0)) * 1000), true)
      : this.computeNextDueAt(timing, toDate(row.startAt)!, false);
    const { nextDueAt, completed } = this.applyEndConditions(row, next, doses.length);
    await tx
      .update(interventionSchedules)
      .set({ nextDueAt, status: completed ? 'completed' : row.status })
      .where(eq(interventionSchedules.id, row.id));
  }
}
