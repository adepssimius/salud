import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { careTeamMemberships, users, patients } from '../../db/schema';

@Injectable()
export class CareTeamService {
  constructor(private readonly db: DatabaseService) {}

  async ensureMembership(patientId: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (!rows.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }
    return rows[0];
  }

  async list(patientId: string, requesterId: string) {
    await this.ensureMembership(patientId, requesterId);
    const db = this.db.db as any;
    const rows = await db
      .select({
        userId: careTeamMemberships.userId,
        role: careTeamMemberships.role,
        email: users.email,
        displayName: users.displayName,
      })
      .from(careTeamMemberships)
      .leftJoin(users, eq(careTeamMemberships.userId, users.id))
      .where(eq(careTeamMemberships.patientId, patientId));

    return rows.map((row: any) => ({
      user: {
        id: row.userId,
        email: row.email,
        displayName: row.displayName,
      },
      role: row.role,
    }));
  }

  async add(patientId: string, requesterId: string, userId: string, role?: string) {
    await this.ensureMembership(patientId, requesterId);
    const db = this.db.db as any;

    const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!found.length) {
      throw new BadRequestException('USER_NOT_FOUND');
    }

    const finalRole =
      role && ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'].includes(role)
        ? role
        : role
        ? 'other'
        : undefined;

    const existing = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (existing.length) {
      // If a role change is requested, update it (with self uniqueness guard)
      if (finalRole && existing[0].role !== finalRole) {
        if (finalRole === 'self') {
          const existingSelf = await db
            .select()
            .from(careTeamMemberships)
            .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.role, 'self')))
            .limit(1);
          if (existingSelf.length && existingSelf[0].userId !== userId) {
            throw new BadRequestException('SELF_RELATIONSHIP_ALREADY_EXISTS');
          }
        }
        await db
          .update(careTeamMemberships)
          .set({ role: finalRole })
          .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)));
      }
      const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return { user: this.pickUser(userRow[0], userId), role: finalRole ?? existing[0].role };
    }

    const validatedRole =
      finalRole ??
      (role && ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'].includes(role)
        ? role
        : 'other');

    if (validatedRole === 'self') {
      const existingSelf = await db
        .select()
        .from(careTeamMemberships)
        .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.role, 'self')))
        .limit(1);
      if (existingSelf.length) {
        throw new BadRequestException('SELF_RELATIONSHIP_ALREADY_EXISTS');
      }
    }

    await db.insert(careTeamMemberships).values({
      id: randomUUID(),
      patientId,
      userId,
      role: validatedRole,
      permissions: 'full',
    });

    return {
      user: this.pickUser(found[0], userId),
      role: validatedRole,
    };
  }

  async remove(patientId: string, requesterId: string, userId: string) {
    await this.ensureMembership(patientId, requesterId);
    const db = this.db.db as any;
    const patientRow = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (patientRow.length && patientRow[0].ownedByUserId === userId) {
      throw new BadRequestException('CANNOT_REMOVE_OWNER');
    }

    const existing = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);

    if (!existing.length) {
      return { deleted: false };
    }

    await db
      .delete(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)));

    return { deleted: true };
  }

  private pickUser(row: any, userId: string) {
    if (!row) {
      return { id: userId, email: null, displayName: null };
    }
    return {
      id: userId,
      email: row.email ?? null,
      displayName: row.displayName ?? null,
    };
  }
}
