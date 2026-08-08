import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { careTeamMemberships, interventionSchedules, interventions } from '../../db/schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { LogScheduleDto } from './dto/log-schedule.dto';
import { InterventionsService } from '../interventions/interventions.service';
import { CreateInterventionDto } from '../interventions/dto/create-intervention.dto';
import { normalizeTs } from '../persistence/time';

interface TimingConfig {
  frequencyHours: number | null;
  explicitTimes: string[] | null;
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly interventionsService: InterventionsService,
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

  // Finds the next occurrence of any HH:MM in `times`, at-or-after `from` (or strictly after,
  // when advancing past a just-logged dose).
  private nextExplicitTime(times: string[], from: Date, strictlyAfter: boolean): Date {
    const sorted = [...times].sort();
    const fromMs = from.getTime();
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      for (const t of sorted) {
        const [h, m] = t.split(':').map(Number);
        const candidate = new Date(from);
        candidate.setDate(from.getDate() + dayOffset);
        candidate.setHours(h, m, 0, 0);
        const ok = strictlyAfter ? candidate.getTime() > fromMs : candidate.getTime() >= fromMs;
        if (ok) return candidate;
      }
    }
    // Unreachable with valid HH:MM input; fail safe rather than throw mid-schedule-math.
    return new Date(fromMs + 24 * 60 * 60 * 1000);
  }

  private computeNextDueAt(timing: TimingConfig, from: Date, strictlyAfter: boolean): Date | null {
    if (timing.frequencyHours) {
      const base = strictlyAfter ? from.getTime() : from.getTime();
      const offsetMs = strictlyAfter ? timing.frequencyHours * 3600_000 : 0;
      return new Date(base + offsetMs);
    }
    if (timing.explicitTimes && timing.explicitTimes.length) {
      return this.nextExplicitTime(timing.explicitTimes, from, strictlyAfter);
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
    const db = this.db.db as any;
    const rows = await db.select().from(interventions).where(eq(interventions.scheduleId, scheduleId));
    return rows.length;
  }

  private async computeAdherence(row: any) {
    const loggedCount = await this.loggedCount(row.id);
    const startAt = row.startAt instanceof Date ? row.startAt : new Date(normalizeTs(row.startAt)! * 1000);
    const now = new Date();
    let expectedCount = 0;
    if (now > startAt) {
      if (row.frequencyHours) {
        const elapsedHours = (now.getTime() - startAt.getTime()) / 3600_000;
        expectedCount = Math.floor(elapsedHours / row.frequencyHours) + 1;
      } else if (row.explicitTimes) {
        const times: string[] = JSON.parse(row.explicitTimes);
        let cursor = this.nextExplicitTime(times, startAt, false);
        let guard = 0;
        while (cursor.getTime() <= now.getTime() && guard < 2000) {
          expectedCount++;
          cursor = this.nextExplicitTime(times, cursor, true);
          guard++;
        }
      }
    }
    const remainingOccurrences =
      row.endAfterOccurrences != null ? Math.max(0, row.endAfterOccurrences - loggedCount) : null;
    const nextDueTs = normalizeTs(row.nextDueAt);
    const overdue = row.status === 'active' && nextDueTs != null && nextDueTs < Math.floor(Date.now() / 1000);
    return {
      expectedCount,
      loggedCount,
      missed: Math.max(0, expectedCount - loggedCount),
      remainingOccurrences,
      overdue,
    };
  }

  private async pickSchedule(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      type: row.type,
      medicationId: row.medicationId ?? null,
      medicationEmbodimentId: row.medicationEmbodimentId ?? null,
      episodeId: row.episodeId ?? null,
      conditionId: row.conditionId ?? null,
      label: row.label,
      doseMg: row.doseMg ?? null,
      doseMl: row.doseMl ?? null,
      pillCount: row.pillCount ?? null,
      bodyLocation: row.bodyLocation ?? null,
      side: row.side ?? null,
      dressingType: row.dressingType ?? null,
      frequencyHours: row.frequencyHours ?? null,
      explicitTimes: row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
      startAt: normalizeTs(row.startAt),
      endAfterOccurrences: row.endAfterOccurrences ?? null,
      endAt: normalizeTs(row.endAt),
      notes: row.notes ?? null,
      status: row.status,
      nextDueAt: normalizeTs(row.nextDueAt),
      createdByUserId: row.createdByUserId,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
      adherence: await this.computeAdherence(row),
    };
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

    const db = this.db.db as any;
    const id = randomUUID();
    const startAtDate = new Date(dto.startAt);
    const timing: TimingConfig = {
      frequencyHours: dto.frequencyHours ?? null,
      explicitTimes: dto.explicitTimes ?? null,
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
    if (dto.endAt !== undefined) updates.endAt = dto.endAt ? new Date(dto.endAt) : null;

    const timingChanged =
      dto.frequencyHours !== undefined || dto.explicitTimes !== undefined || dto.status !== undefined;

    if (timingChanged) {
      const newStatus = dto.status ?? row.status;
      if (newStatus === 'paused' || newStatus === 'completed') {
        updates.nextDueAt = null;
      } else {
        const timing: TimingConfig = {
          frequencyHours: dto.frequencyHours !== undefined ? dto.frequencyHours : row.frequencyHours,
          explicitTimes:
            dto.explicitTimes !== undefined ? dto.explicitTimes : row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
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
          base = row.startAt instanceof Date ? row.startAt : new Date(normalizeTs(row.startAt)! * 1000);
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
        doseSource: 'override' as const,
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
}
