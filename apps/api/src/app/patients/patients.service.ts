import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { careTeamMemberships, patients, users } from '../../db/schema';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { UpdateCodeStatusDto } from './dto/update-code-status.dto';
import { RevisionsService } from '../revisions/revisions.service';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly revisionsService: RevisionsService,
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

  async remove(id: string, userId: string) {
    // Ensure access and existence
    await this.get(id, userId);
    const db = this.db.db as any;
    await db.delete(careTeamMemberships).where(eq(careTeamMemberships.patientId, id));
    await db.delete(patients).where(eq(patients.id, id));
    return { deleted: true };
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
