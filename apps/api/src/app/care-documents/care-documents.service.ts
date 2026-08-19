import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import {
  CARE_DOCUMENT_KINDS,
  CareDocumentKind,
  CareDocumentStatement,
  CareDocumentsMap,
} from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import { careDocumentStatements, careTeamMemberships, fileAssets, users } from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { SetCareDocumentDto } from './dto/set-care-document.dto';

/** Wire keys for the three kinds — the map's shape is part of the response contract (api.md). */
const KIND_TO_KEY: Record<CareDocumentKind, keyof CareDocumentsMap> = {
  living_will: 'livingWill',
  advance_directive: 'advanceDirective',
  medical_poa: 'medicalPoa',
};

@Injectable()
export class CareDocumentsService {
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

  /**
   * Hydrates rows into statements: resolves the setter's display name (like the ER Brief's
   * codeStatus does) and the file's name/type, so a card renders without a second fetch.
   */
  private async hydrate(rows: any[]): Promise<CareDocumentStatement[]> {
    if (!rows.length) return [];
    const db = this.db.db as any;

    const userIds = [...new Set(rows.map((r) => r.setByUserId))];
    const userRows = await db.select().from(users).where(inArray(users.id, userIds));
    const nameById = new Map<string, string>(userRows.map((u: any) => [u.id, u.displayName]));

    const fileIds = [...new Set(rows.map((r) => r.fileId).filter(Boolean))] as string[];
    const fileRows = fileIds.length
      ? await db.select().from(fileAssets).where(inArray(fileAssets.id, fileIds))
      : [];
    const fileById = new Map<string, any>(fileRows.map((f: any) => [f.id, f]));

    return rows.map((row) => {
      const file = row.fileId ? fileById.get(row.fileId) : null;
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        fileId: row.fileId ?? null,
        originalName: file?.originalName ?? null,
        contentType: file?.contentType ?? null,
        holderName: row.holderName ?? null,
        holderPhone: row.holderPhone ?? null,
        setByUserId: row.setByUserId,
        setByName: nameById.get(row.setByUserId) ?? 'unknown',
        setAt: normalizeTs(row.setAt)!,
      };
    });
  }

  /**
   * The current statement per kind is the last one appended — the table is append-only, so
   * "current" is derived, never stored. Kinds with no row at all stay `null`: that is the "not
   * recorded" arm of the tri-state and is deliberately distinct from a stored `status: 'none'`.
   *
   * Ordered by `seq`, not `setAt` — see the column's comment: on SQLite two statements written in
   * the same second carry the same timestamp, and picking "current" off the clock would be a coin
   * flip between a document and the statement that superseded it.
   */
  async getMap(patientId: string, userId: string): Promise<CareDocumentsMap> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careDocumentStatements)
      .where(eq(careDocumentStatements.patientId, patientId))
      .orderBy(desc(careDocumentStatements.seq));

    const map: CareDocumentsMap = { livingWill: null, advanceDirective: null, medicalPoa: null };
    const newestPerKind: any[] = [];
    for (const kind of CARE_DOCUMENT_KINDS) {
      const newest = rows.filter((r: any) => r.kind === kind)[0];
      if (newest) newestPerKind.push(newest);
    }
    for (const statement of await this.hydrate(newestPerKind)) {
      map[KIND_TO_KEY[statement.kind]] = statement;
    }
    return map;
  }

  /** Every statement ever recorded for one kind, newest first — the append-only trail (N-2). */
  async getHistory(
    patientId: string,
    kind: CareDocumentKind,
    userId: string,
  ): Promise<CareDocumentStatement[]> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careDocumentStatements)
      .where(
        and(eq(careDocumentStatements.patientId, patientId), eq(careDocumentStatements.kind, kind)),
      )
      .orderBy(desc(careDocumentStatements.seq));
    return await this.hydrate(rows);
  }

  /**
   * Appends a new current statement — never updates in place, so what the household stated and
   * when survives every later correction. `setByUserId`/`setAt` are stamped from the actor here
   * and are never accepted from the client (P3), the same rule PATCH .../code-status follows.
   */
  async set(
    patientId: string,
    kind: CareDocumentKind,
    userId: string,
    dto: SetCareDocumentDto,
  ): Promise<CareDocumentsMap> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;

    // The status/fileId pairing itself is a DTO-level validation concern
    // (MatchesCareDocumentStatus); what needs a database read is whether the file is really this
    // patient's.
    if (dto.status === 'on_file') {
      await this.assertFileUsable(dto.fileId!, patientId);
    }

    // Holder details describe who holds the power of attorney; the other two kinds have no holder,
    // so they are rejected rather than dropped — silently discarding them would leave the caller
    // believing it stored a contact that no reader will ever surface. Plain prose rather than a
    // code, like the DTO's own pairing message: the web form only offers these fields on the PoA
    // kind, so reaching here is a malformed request, not a caregiver-facing condition.
    const isPoa = kind === 'medical_poa';
    if (!isPoa && (dto.holderName != null || dto.holderPhone != null)) {
      throw new BadRequestException('holderName and holderPhone apply only to medical_poa');
    }

    // max(seq) + 1 within this (patient, kind). Two concurrent writes could collide on a value,
    // which is no worse than the timestamp tie this replaces and is not a real shape for a
    // single-household app — one caregiver, one deliberate act, per kind.
    const [{ maxSeq }] = await db
      .select({ maxSeq: max(careDocumentStatements.seq) })
      .from(careDocumentStatements)
      .where(
        and(eq(careDocumentStatements.patientId, patientId), eq(careDocumentStatements.kind, kind)),
      );

    await db.insert(careDocumentStatements).values({
      id: randomUUID(),
      patientId,
      kind,
      status: dto.status,
      seq: (maxSeq ?? 0) + 1,
      fileId: dto.status === 'on_file' ? dto.fileId! : null,
      holderName: isPoa ? (dto.holderName ?? null) : null,
      holderPhone: isPoa ? (dto.holderPhone ?? null) : null,
      setByUserId: userId,
      setAt: new Date(),
    });

    return await this.getMap(patientId, userId);
  }

  /**
   * Write-side reference check, mirroring FilesService.assertUsableForPatient: a shape-valid UUID
   * naming nothing is a permanently broken link in the ER Brief header, so it is caught at write
   * time rather than discovered at triage.
   */
  private async assertFileUsable(fileId: string, patientId: string): Promise<void> {
    const db = this.db.db as any;
    const rows = await db.select().from(fileAssets).where(eq(fileAssets.id, fileId)).limit(1);
    if (!rows.length) throw new BadRequestException('CARE_DOCUMENT_FILE_NOT_FOUND');
    if (rows[0].patientId !== patientId) throw new BadRequestException('CARE_DOCUMENT_FILE_NOT_FOUND');
  }
}
