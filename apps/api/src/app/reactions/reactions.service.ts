import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { adverseReactions, careTeamMemberships } from '../../db/schema';
import { CreateReactionDto } from './dto/create-reaction.dto';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class ReactionsService {
  constructor(private readonly db: DatabaseService) {}

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

  private pickReaction(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      description: row.description,
      occurredAt: normalizeTs(row.occurredAt),
      recordedByUserId: row.recordedByUserId,
      severity: row.severity,
      scopeType: row.scopeType,
      medicationId: row.medicationId ?? null,
      embodimentId: row.embodimentId ?? null,
      tag: row.tag ?? null,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  // Exactly one of medicationId/embodimentId/tag must be set, matching scopeType
  // (data-model.md → "Data integrity rules"). The app never infers cross-reactivity (P6).
  private validateScope(dto: CreateReactionDto) {
    const targets = {
      embodiment: dto.embodimentId,
      medication: dto.medicationId,
      tag: dto.tag,
    } as const;
    const setCount = [dto.medicationId, dto.embodimentId, dto.tag].filter((v) => v !== undefined && v !== null).length;
    if (setCount !== 1 || !targets[dto.scopeType]) {
      throw new BadRequestException('INVALID_REACTION_SCOPE');
    }
  }

  async create(patientId: string, userId: string, dto: CreateReactionDto) {
    await this.ensurePatientAccess(patientId, userId);
    this.validateScope(dto);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(adverseReactions).values({
      id,
      patientId,
      description: dto.description,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : null,
      recordedByUserId: userId,
      severity: dto.severity,
      scopeType: dto.scopeType,
      medicationId: dto.medicationId ?? null,
      embodimentId: dto.embodimentId ?? null,
      tag: dto.tag ?? null,
    });
    const rows = await db.select().from(adverseReactions).where(eq(adverseReactions.id, id)).limit(1);
    return this.pickReaction(rows[0]);
  }

  async listForPatient(patientId: string, userId: string) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(adverseReactions)
      .where(eq(adverseReactions.patientId, patientId))
      // COALESCE, not a plain DESC on occurredAt: SQL sorts NULLs last, which would silently
      // demote undated reactions to the bottom of a list whose whole point is that they're
      // remembered. An undated one sorts by when it was recorded instead (api.md).
      .orderBy(desc(sql`coalesce(${adverseReactions.occurredAt}, ${adverseReactions.createdAt})`));
    return rows.map((r: any) => this.pickReaction(r));
  }
  /**
   * A reaction drives a full-screen danger interstitial on *every* future dose of that medication,
   * so a mis-scoped entry with no way to remove it is worse than the absence of a UI. "Remembered
   * forever" (§4.9) means the app never expires a reaction on its own — not that a caregiver can't
   * undo their own typo.
   */
  async remove(patientId: string, id: string, userId: string) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db.select().from(adverseReactions).where(eq(adverseReactions.id, id)).limit(1);
    // Belonging to a different patient is the same answer as not existing — no probing.
    if (!rows.length || rows[0].patientId !== patientId) {
      throw new NotFoundException('REACTION_NOT_FOUND');
    }
    await db.delete(adverseReactions).where(eq(adverseReactions.id, id));
    return { deleted: true };
  }
}
