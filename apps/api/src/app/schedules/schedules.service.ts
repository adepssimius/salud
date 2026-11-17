import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { careTeamMemberships, interventionSchedules, interventions, scheduleSkips } from '../../db/schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { LogScheduleDto } from './dto/log-schedule.dto';
import { UpdateScheduleDosesDto } from './dto/update-schedule-doses.dto';
import { RevisionsService } from '../revisions/revisions.service';
import { InterventionSchedule, ScheduleDeleteResponse, ScheduleDose, ScheduleDosesResponse, ScheduleSkip } from '@salud/shared/types';
import { SkipScheduleDoseDto } from './dto/skip-schedule-dose.dto';
import { persistScheduleState, scheduleStateFor } from './schedule-state';
import { InterventionsService } from '../interventions/interventions.service';
import { CreateInterventionDto } from '../interventions/dto/create-intervention.dto';
import { normalizeTs } from '../persistence/time';
import { toScheduleView } from './schedule-view';
import { isValidTimeZone } from './zoned-time';

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
    this.assertMissedDoseInstruction({
      action: dto.missedDoseAction ?? null,
      cutoffHours: dto.missedDoseCutoffHours ?? null,
      courseEffect: dto.missedDoseCourseEffect ?? null,
      hasEnd: dto.endAt != null || dto.endAfterOccurrences != null,
    });

    const db = this.db.db as any;
    const id = randomUUID();
    const startAtDate = new Date(dto.startAt);

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
      missedDoseAction: dto.missedDoseAction ?? null,
      missedDoseCutoffHours: dto.missedDoseCutoffHours ?? null,
      missedDoseCourseEffect: dto.missedDoseCourseEffect ?? null,
      missedDoseNote: dto.missedDoseNote?.trim() || null,
      startAt: startAtDate,
      endAfterOccurrences: dto.endAfterOccurrences ?? null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      notes: dto.notes ?? null,
      status: 'active',
      nextDueAt: null,
      createdByUserId: userId,
    });
    // The first due moment comes from the same state every later write uses.
    await persistScheduleState(db, id);

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

  /**
   * Edit a schedule (api.md → Intervention schedules → "Editing a schedule"): any subset of the
   * create fields, checked on the merged result exactly as create checks the body. The edit
   * replaces the plan as if it had always been so — adherence, missed and next due are recomputed
   * over the whole course from the new timing; linked doses stay linked. `type` and the medicine
   * cannot change once a dose is linked (409 SCHEDULE_HAS_DOSES): a dose of one medicine would
   * otherwise count toward a schedule for another.
   */
  async update(id: string, userId: string, dto: UpdateScheduleDto) {
    const row = await this.getRow(id, userId);
    const db = this.db.db as any;

    // Required columns: null is not a value for them, only "not sent".
    for (const key of ['type', 'label', 'startAt', 'status', 'timeZone'] as const) {
      if (dto[key] === null) delete dto[key];
    }

    // Setting one timing mode clears the other, so the web can switch "every N hours" to "times a
    // day" without sending both; both sent stays an explicit choice of the caller.
    if (dto.frequencyHours != null && dto.explicitTimes === undefined) dto.explicitTimes = null;
    if (dto.explicitTimes != null && dto.frequencyHours === undefined) dto.frequencyHours = null;

    const merged = <K extends keyof UpdateScheduleDto>(key: K, column: string = key) =>
      dto[key] !== undefined ? dto[key] : row[column];
    const type = merged('type');

    // A changed type clears the other type's fields: a dressing change has no medicine, and a dose
    // no body location.
    if (dto.type !== undefined && dto.type !== row.type) {
      const cleared =
        dto.type === 'medication_dose'
          ? (['bodyLocation', 'side', 'dressingType'] as const)
          : (['medicationId', 'medicationEmbodimentId', 'doseMg', 'doseMl', 'pillCount'] as const);
      for (const key of cleared) if (dto[key] === undefined) (dto as any)[key] = null;
    }

    const typeChanges = dto.type !== undefined && dto.type !== row.type;
    const medicineChanges = dto.medicationId !== undefined && (dto.medicationId ?? null) !== (row.medicationId ?? null);
    if (typeChanges || medicineChanges) {
      const linked = await db.select({ id: interventions.id }).from(interventions).where(eq(interventions.scheduleId, id)).limit(1);
      if (linked.length) throw new ConflictException('SCHEDULE_HAS_DOSES');
    }

    if (type === 'medication_dose' && !merged('medicationId')) {
      throw new BadRequestException('MEDICATION_ID_REQUIRED');
    }
    if (type === 'dressing_change' && !merged('bodyLocation')) {
      throw new BadRequestException('BODY_LOCATION_REQUIRED');
    }
    if (merged('frequencyHours') == null && merged('explicitTimes') == null) {
      throw new BadRequestException('FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED');
    }
    if (merged('episodeId') && merged('conditionId')) {
      throw new BadRequestException('SCHEDULE_EPISODE_CONDITION_CONFLICT');
    }
    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException('INVALID_TIME_ZONE');
    }
    // Checked against the merged result, as a correction is.
    this.assertMissedDoseInstruction({
      action: (merged('missedDoseAction') as any) ?? null,
      cutoffHours: (merged('missedDoseCutoffHours') as any) ?? null,
      courseEffect: (merged('missedDoseCourseEffect') as any) ?? null,
      hasEnd: merged('endAt') != null || merged('endAfterOccurrences') != null,
    });

    const updates: Record<string, any> = {};
    const directFields = [
      'type',
      'label',
      'episodeId',
      'conditionId',
      'medicationId',
      'medicationEmbodimentId',
      'doseMg',
      'doseMl',
      'pillCount',
      'bodyLocation',
      'side',
      'dressingType',
      'frequencyHours',
      'timeZone',
      'endAfterOccurrences',
      'notes',
      'status',
      'missedDoseAction',
      'missedDoseCutoffHours',
      'missedDoseCourseEffect',
    ] as const;
    for (const key of directFields) {
      if (dto[key] !== undefined) updates[key] = dto[key];
    }
    if (dto.explicitTimes !== undefined) updates.explicitTimes = dto.explicitTimes ? JSON.stringify(dto.explicitTimes) : null;
    if (dto.startAt !== undefined) updates.startAt = new Date(dto.startAt);
    if (dto.endAt !== undefined) updates.endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (dto.missedDoseNote !== undefined) updates.missedDoseNote = dto.missedDoseNote?.trim() || null;

    if (Object.keys(updates).length) {
      await db.update(interventionSchedules).set({ ...updates, updatedAt: new Date() }).where(eq(interventionSchedules.id, id));
    }
    // Timing, status, end and instruction all move the next due moment; recompute from the result.
    await persistScheduleState(db, id);

    return this.get(id, userId);
  }

  /**
   * Delete a schedule (api.md → Intervention schedules → "Deleting a schedule"). A hard delete of
   * the plan, never of the care record: every linked dose stays, loses its link (`scheduleId`,
   * `metadata.interventionScheduleId`, `metadata.scheduleLinked`) and gets a Revision of its prior
   * state, so its History still shows the schedule it was on; its `doseSource` is left as it was.
   * The schedule's skips are plan bookkeeping and go with it. One transaction.
   */
  async remove(id: string, userId: string): Promise<ScheduleDeleteResponse> {
    await this.getRow(id, userId);
    const db = this.db.db as any;
    const doses: any[] = await db.select().from(interventions).where(eq(interventions.scheduleId, id));
    const skips: any[] = await db.select({ id: scheduleSkips.id }).from(scheduleSkips).where(eq(scheduleSkips.scheduleId, id));

    // Snapshots before the transaction opens (RevisionsService.capture's contract).
    const snapshots = new Map<string, any>();
    for (const d of doses) snapshots.set(d.id, await this.interventionsService.get(d.id, userId));

    await this.db.withTransaction(async (tx: any) => {
      for (const d of doses) {
        const m = d.metadata ? JSON.parse(d.metadata) : {};
        m.interventionScheduleId = null;
        delete m.scheduleLinked;
        await this.revisionsService.capture('intervention', d.id, snapshots.get(d.id), userId, tx);
        await tx
          .update(interventions)
          .set({ scheduleId: null, metadata: JSON.stringify(m), updatedAt: new Date() })
          .where(eq(interventions.id, d.id));
      }
      await tx.delete(scheduleSkips).where(eq(scheduleSkips.scheduleId, id));
      await tx.delete(interventionSchedules).where(eq(interventionSchedules.id, id));
    });

    return { deleted: true, unlinkedDoseCount: doses.length, removedSkipCount: skips.length };
  }

  async log(id: string, userId: string, dto: LogScheduleDto) {
    const row = await this.getRow(id, userId);

    const performedAtDate = dto.performedAt ? new Date(dto.performedAt) : new Date();
    // "Take two next time": the schedule's own amounts, doubled. InterventionsService.create checks
    // that the instruction is in force and records the missed slot as made up.
    const factor = dto.double ? 2 : 1;
    const times = (v: number | null) => (v != null ? v * factor : undefined);

    const interventionDto: CreateInterventionDto = {
      performedAt: performedAtDate.toISOString(),
      type: row.type,
      episodeIds: row.episodeId ? [row.episodeId] : undefined,
      notes: dto.notes,
      interventionScheduleId: id,
      ...(dto.double ? { prescribedDouble: true } : {}),
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
        amountMg: times(row.doseMg),
        amountMl: times(row.doseMl),
        pillCount: times(row.pillCount),
      });
    } else {
      Object.assign(interventionDto, {
        bodyLocation: row.bodyLocation ?? undefined,
        side: row.side ?? undefined,
        dressingType: row.dressingType ?? undefined,
      });
    }

    // The dose path itself advances the schedule (InterventionsService.create persists its state),
    // so a dose logged here and one filed from the dose form move it identically.
    const created = await this.interventionsService.create(row.patientId, userId, interventionDto);

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
      if (changed.length) await persistScheduleState(tx, row.id);
    });

    return this.doses(id, userId);
  }

  // ── Missed doses (api.md → Intervention schedules → "Missed doses") ───────────────────────

  /**
   * A cutoff belongs only to a take-late instruction (it says when to skip instead), and a course
   * effect only to a course that ends — otherwise there is nothing for either to act on.
   */
  private assertMissedDoseInstruction(v: { action: string | null; cutoffHours: number | null; courseEffect: string | null; hasEnd: boolean }) {
    const takeLate = v.action === 'take_late_keep_times' || v.action === 'take_late_restart';
    if (v.cutoffHours != null && !takeLate) throw new BadRequestException('MISSED_DOSE_INSTRUCTION_INVALID');
    if (v.courseEffect != null && !v.hasEnd) throw new BadRequestException('MISSED_DOSE_INSTRUCTION_INVALID');
  }

  /**
   * The caregiver skips the current missed dose: the slot is recorded as skipped (not missed), and
   * the next due moves on. Only the current missed slot can be skipped — the app records what was
   * done, never decides it (P6). 400 SCHEDULE_SLOT_NOT_SKIPPABLE otherwise.
   */
  async skip(id: string, userId: string, dto: SkipScheduleDoseDto): Promise<InterventionSchedule> {
    const row = await this.getRow(id, userId);
    const db = this.db.db as any;
    const state = await scheduleStateFor(db, row);
    const slotAt = state.missedDose?.slotAt ?? null;
    if (slotAt == null || (dto.slotAt != null && dto.slotAt !== slotAt)) {
      throw new BadRequestException('SCHEDULE_SLOT_NOT_SKIPPABLE');
    }
    await this.db.withTransaction(async (tx: any) => {
      await tx.insert(scheduleSkips).values({
        id: randomUUID(),
        scheduleId: id,
        slotAt: new Date(slotAt * 1000),
        reason: 'skipped',
        recordedByUserId: userId,
      });
      await persistScheduleState(tx, id);
    });
    return this.get(id, userId);
  }

  /** The schedule's skipped slots, newest first. */
  async listSkips(id: string, userId: string): Promise<ScheduleSkip[]> {
    await this.getRow(id, userId);
    const db = this.db.db as any;
    const rows: any[] = await db.select().from(scheduleSkips).where(eq(scheduleSkips.scheduleId, id));
    return rows
      .map((r) => ({
        id: r.id,
        scheduleId: r.scheduleId,
        slotAt: normalizeTs(r.slotAt)!,
        reason: r.reason,
        recordedByUserId: r.recordedByUserId,
        createdAt: normalizeTs(r.createdAt)!,
      }))
      .sort((a, b) => b.slotAt - a.slotAt);
  }

  /**
   * Undo a skip tapped by mistake: the slot is missed again. A slot made up by a prescribed double
   * belongs to that dose and goes only with it (400 SCHEDULE_SKIP_NOT_UNDOABLE).
   */
  async unskip(id: string, skipId: string, userId: string): Promise<InterventionSchedule> {
    await this.getRow(id, userId);
    const db = this.db.db as any;
    const rows: any[] = await db
      .select()
      .from(scheduleSkips)
      .where(and(eq(scheduleSkips.id, skipId), eq(scheduleSkips.scheduleId, id)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('SCHEDULE_SKIP_NOT_FOUND');
    if (rows[0].reason !== 'skipped') throw new BadRequestException('SCHEDULE_SKIP_NOT_UNDOABLE');
    await this.db.withTransaction(async (tx: any) => {
      await tx.delete(scheduleSkips).where(eq(scheduleSkips.id, skipId));
      await persistScheduleState(tx, id);
    });
    return this.get(id, userId);
  }
}
