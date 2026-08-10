import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  advisories,
  adverseReactions,
  careTeamMemberships,
  conditions,
  episodes,
  episodesEventsPivot,
  erBriefSnapshots,
  fileAssets,
  interventions,
  interventionSchedules,
  observationEntries,
  observations,
  patients,
  protocols,
  revisions,
  users,
} from '../../db/schema';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { UpdateCodeStatusDto } from './dto/update-code-status.dto';
import { RevisionsService } from '../revisions/revisions.service';
import { StorageService } from '../storage/storage.service';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class PatientsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly revisionsService: RevisionsService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreatePatientDto, userId: string) {
    const db = this.db.db as any;
    const id = randomUUID();
    const role = dto.myRole ?? 'parent';

    const inserted = await db.insert(patients).values({
      id,
      fullName: dto.fullName,
      dateOfBirth: dto.dateOfBirth,
      sexAtBirth: dto.sexAtBirth,
      notes: dto.notes,
      ownedByUserId: userId,
    }).returning();

    await db.insert(careTeamMemberships).values({
      id: randomUUID(),
      patientId: id,
      userId,
      role,
      permissions: 'full',
    });

    const patientRow = inserted && inserted[0] ? inserted[0] : await this.getRawPatient(id);
    return this.pickPatient(patientRow, role);
  }

  private async getRawPatient(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('PATIENT_NOT_FOUND');
    return rows[0];
  }

  // Owner-only, and the two checks must run in this order: membership first so a non-member gets
  // 404 and never learns 403 was even possible (api.md → "Resource shape and access control"),
  // ownership second. Mirrors care-team.service.ts's CANNOT_REMOVE_OWNER guard — without it,
  // removing a single caregiver was protected while destroying the whole record was not.
  async remove(id: string, userId: string) {
    const row = await this.getAuthorizedPatientRow(id, userId);
    if (row.patients.ownedByUserId !== userId) {
      throw new ForbiddenException('NOT_PATIENT_OWNER');
    }

    const db = this.db.db as any;

    // Read the blob paths *before* the transaction — the sqlite branch of withTransaction() shares
    // one connection, so nothing may read between BEGIN and COMMIT.
    const blobRows = await db
      .select({ path: fileAssets.path })
      .from(fileAssets)
      .where(eq(fileAssets.patientId, id));

    await this.db.withTransaction(async (tx: any) => {
      await this.deletePatientRows(tx, id);
    });

    // After COMMIT, best-effort. A failed unlink must not roll back the delete, and an unlinked
    // blob whose row was rolled back would be the worse of the two failures. These are clinical
    // photos of a child on a volume nothing ever garbage-collects, so leaving them is a privacy
    // problem rather than housekeeping (data-model.md → Data integrity rules).
    if (this.storage.driver === 'local' && blobRows.length) {
      await Promise.allSettled(
        blobRows.map((r: any) => this.storage.delete(r.path)),
      );
    }

    return { deleted: true };
  }

  // Children first, patient last. Ordering follows the real FK edges — which sqlite does not
  // enforce today (the foreign_keys pragma is never set) but postgres/mysql would — and the
  // subqueries need their parent tables still populated when they run.
  private async deletePatientRows(tx: any, id: string) {
    const observationIds = tx.select({ id: observations.id }).from(observations).where(eq(observations.patientId, id));
    const interventionIds = tx.select({ id: interventions.id }).from(interventions).where(eq(interventions.patientId, id));
    const episodeIds = tx.select({ id: episodes.id }).from(episodes).where(eq(episodes.patientId, id));
    const conditionIds = tx.select({ id: conditions.id }).from(conditions).where(eq(conditions.patientId, id));

    await tx.delete(observationEntries).where(inArray(observationEntries.observationId, observationIds));

    // `eventId` is polymorphic with no FK, so no cascade could ever reach these. Matching on it as
    // well as on `episodeId` also cleans up rows written before episodes were scoped to a patient —
    // an event of this patient linked into some *other* patient's episode. Keep both clauses.
    await tx.delete(episodesEventsPivot).where(
      or(
        inArray(episodesEventsPivot.episodeId, episodeIds),
        inArray(episodesEventsPivot.eventId, observationIds),
        inArray(episodesEventsPivot.eventId, interventionIds),
      ),
    );

    // Also polymorphic (entityType/entityId), also unreachable by cascade.
    await tx.delete(revisions).where(
      or(
        and(eq(revisions.entityType, 'patient'), eq(revisions.entityId, id)),
        and(eq(revisions.entityType, 'observation'), inArray(revisions.entityId, observationIds)),
        and(eq(revisions.entityType, 'intervention'), inArray(revisions.entityId, interventionIds)),
        and(eq(revisions.entityType, 'condition'), inArray(revisions.entityId, conditionIds)),
      ),
    );

    await tx.delete(advisories).where(eq(advisories.patientId, id));
    await tx.delete(erBriefSnapshots).where(eq(erBriefSnapshots.patientId, id));
    await tx.delete(adverseReactions).where(eq(adverseReactions.patientId, id));
    await tx.delete(observations).where(eq(observations.patientId, id));
    await tx.delete(interventions).where(eq(interventions.patientId, id));
    await tx.delete(interventionSchedules).where(eq(interventionSchedules.patientId, id));
    await tx.delete(episodes).where(eq(episodes.patientId, id));
    await tx.delete(protocols).where(inArray(protocols.conditionId, conditionIds));
    await tx.delete(conditions).where(eq(conditions.patientId, id));
    await tx.delete(fileAssets).where(eq(fileAssets.patientId, id));
    await tx.delete(careTeamMemberships).where(eq(careTeamMemberships.patientId, id));
    await tx.delete(patients).where(eq(patients.id, id));
  }

  async listForUser(userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(patients)
      .leftJoin(
        careTeamMemberships,
        eq(careTeamMemberships.patientId, patients.id),
      )
      .where(eq(careTeamMemberships.userId, userId));

    return rows.map((row: any) =>
      this.pickPatient(row.patients, row.care_team_memberships?.role),
    );
  }

  async get(id: string, userId: string) {
    const row = await this.getAuthorizedPatientRow(id, userId);
    return this.pickPatient(row.patients, row.care_team_memberships?.role);
  }

  async update(id: string, userId: string, dto: UpdatePatientDto) {
    // Ensure access
    const preUpdateRow = await this.getAuthorizedPatientRow(id, userId);
    await this.revisionsService.capture(
      'patient',
      id,
      this.pickPatient(preUpdateRow.patients, preUpdateRow.care_team_memberships?.role),
      userId,
    );
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.fullName) updates.fullName = dto.fullName;
    if (dto.dateOfBirth) updates.dateOfBirth = dto.dateOfBirth;
    if (dto.sexAtBirth) updates.sexAtBirth = dto.sexAtBirth;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    let newOwnerId: string | undefined;
    if (dto.ownedById) {
      const userRow = await db.select().from(users).where(eq(users.id, dto.ownedById)).limit(1);
      if (!userRow.length) {
        throw new NotFoundException('USER_NOT_FOUND');
      }
      updates.ownedByUserId = dto.ownedById;
      newOwnerId = dto.ownedById;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(patients).set(updates).where(eq(patients.id, id));
    }

    if (newOwnerId) {
      // ensure new owner is on care team
      const existing = await db
        .select()
        .from(careTeamMemberships)
        .where(and(eq(careTeamMemberships.patientId, id), eq(careTeamMemberships.userId, newOwnerId)))
        .limit(1);
      if (!existing.length) {
        await db.insert(careTeamMemberships).values({
          id: randomUUID(),
          patientId: id,
          userId: newOwnerId,
          role: 'parent',
          permissions: 'full',
        });
      }
    }

    const row = await this.getAuthorizedPatientRow(id, userId);
    return this.pickPatient(row.patients, row.care_team_memberships?.role);
  }

  private pickPatient(patient: any, myRole?: string) {
    return {
      id: patient.id,
      fullName: patient.fullName,
      dateOfBirth: patient.dateOfBirth,
      sexAtBirth: patient.sexAtBirth,
      notes: patient.notes,
      ownedById: patient.ownedByUserId,
      latestWeightKg: patient.latestWeightKg,
      latestWeightRecordedAt: normalizeTs(patient.latestWeightRecordedAt),
      myRole: myRole ?? null,
      codeStatus: patient.codeStatus ?? null,
      codeStatusSetByUserId: patient.codeStatusSetByUserId ?? null,
      codeStatusSetAt: normalizeTs(patient.codeStatusSetAt),
    };
  }

  // Deliberate, separate act (data-model.md → Patient) — attribution is stamped server-side and
  // is never reachable through the general PATCH.
  async updateCodeStatus(id: string, userId: string, dto: UpdateCodeStatusDto) {
    await this.getAuthorizedPatientRow(id, userId);
    const db = this.db.db as any;
    await db
      .update(patients)
      .set({ codeStatus: dto.codeStatus, codeStatusSetByUserId: userId, codeStatusSetAt: new Date() })
      .where(eq(patients.id, id));
    const row = await this.getAuthorizedPatientRow(id, userId);
    return this.pickPatient(row.patients, row.care_team_memberships?.role);
  }

  private async getAuthorizedPatientRow(id: string, userId: string) {
    const db = this.db.db as any;
    const membership = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, id), eq(careTeamMemberships.userId, userId)))
      .limit(1);

    if (!membership.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }

    const patientRow = await db
      .select()
      .from(patients)
      .where(eq(patients.id, id))
      .limit(1);

    if (!patientRow.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }

    return { patients: patientRow[0], care_team_memberships: membership[0] } as any;
  }

  async getRevisions(id: string, userId: string) {
    await this.getAuthorizedPatientRow(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('patient', id);
  }
}
