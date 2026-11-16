import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { revisions } from '../../db/schema';
import { Revision, RevisionEntityType } from '@salud/shared/types';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class RevisionsService {
  constructor(private readonly db: DatabaseService) {}

  // Called by an entity's own service, immediately before applying a PATCH — captures the
  // pre-update state in the same shape the entity's own GET returns (data-model.md → Revision).
  //
  // `tx`, when given, is the handle from `DatabaseService.withTransaction`: the revision is then
  // written in the same transaction as the change it precedes, so a PATCH rejected partway
  // captures nothing (data-model.md → Revision). Without it the insert stands alone, as the
  // conditions and patients PATCHes still use it. Writes only — take the snapshot before the
  // transaction opens.
  async capture(
    entityType: RevisionEntityType,
    entityId: string,
    snapshot: Record<string, any>,
    editedByUserId: string,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? (this.db.db as any);
    await db.insert(revisions).values({
      id: randomUUID(),
      entityType,
      entityId,
      snapshot: JSON.stringify(snapshot),
      editedByUserId,
    });
  }

  async listFor(entityType: RevisionEntityType, entityId: string): Promise<Revision[]> {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(revisions)
      .where(and(eq(revisions.entityType, entityType), eq(revisions.entityId, entityId)))
      .orderBy(desc(revisions.editedAt));
    return rows.map((r: any) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      snapshot: JSON.parse(r.snapshot),
      editedByUserId: r.editedByUserId,
      editedAt: normalizeTs(r.editedAt)!,
    }));
  }
}
