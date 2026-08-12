import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import path from 'path';
import { and, desc, eq } from 'drizzle-orm';
import { PatientFileSummary } from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import { StorageService } from '../storage/storage.service';
import { normalizeTs } from '../persistence/time';
import { careTeamMemberships, fileAssets } from '../../db/schema';

export interface UploadInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
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

  // Display-only (data-model.md → FileAsset.originalName): strip any path components and control
  // characters, cap the length. The storage path stays a server-generated UUID regardless.
  private sanitizeOriginalName(originalname: string | undefined): string | null {
    if (!originalname) return null;
    // eslint-disable-next-line no-control-regex
    const cleaned = path.basename(originalname).replace(/[\x00-\x1f\x7f]/g, '').trim();
    return cleaned ? cleaned.slice(0, 255) : null;
  }

  async upload(userId: string, patientId: string, file: UploadInput): Promise<{ fileId: string; url: string }> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const id = randomUUID();
    const relativePath = `${id}${path.extname(file.originalname)}`;
    await this.storage.write(relativePath, file.buffer);
    await db.insert(fileAssets).values({
      id,
      bucket: 'local',
      path: relativePath,
      contentType: file.mimetype,
      sizeBytes: file.size,
      originalName: this.sanitizeOriginalName(file.originalname),
      patientId,
      createdByUserId: userId,
    });
    return { fileId: id, url: `/api/files/${id}` };
  }

  // Backs the "attach an existing document" picker (api.md → Files).
  async listForPatient(patientId: string, userId: string): Promise<PatientFileSummary[]> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(fileAssets)
      .where(eq(fileAssets.patientId, patientId))
      .orderBy(desc(fileAssets.createdAt));
    return rows.map((row: any) => ({
      id: row.id,
      originalName: row.originalName ?? null,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      createdAt: normalizeTs(row.createdAt),
    }));
  }

  /**
   * Write-side check for a photo/document observation entry's `metadata.fileId` (and the
   * lab-import parse endpoint's `fileId`, via getUsableForPatient below).
   *
   * Same access shape as getForStream above, but it throws the caller's 400 code (default
   * PHOTO_FILE_NOT_FOUND) rather than FILE_NOT_FOUND (404): this is a bad request body, not a
   * missing resource. One code covers all four failure modes — no such file, another patient's
   * file, someone else's unattached upload — for exactly the reason getForStream doesn't
   * distinguish them either.
   *
   * Catching this at write time rather than at read time is the point: a shape-valid UUID naming
   * nothing is a permanently broken image in the timeline and the ER Brief.
   */
  async assertUsableForPatient(
    fileId: string,
    patientId: string,
    userId: string,
    code = 'PHOTO_FILE_NOT_FOUND',
  ): Promise<void> {
    await this.getUsableForPatient(fileId, patientId, userId, code);
  }

  /** assertUsableForPatient, but hands back the row for callers that need path/contentType. */
  async getUsableForPatient(
    fileId: string,
    patientId: string,
    userId: string,
    code: string,
  ): Promise<{ path: string; contentType: string }> {
    const db = this.db.db as any;
    const rows = await db.select().from(fileAssets).where(eq(fileAssets.id, fileId)).limit(1);
    if (!rows.length) throw new BadRequestException(code);
    const row = rows[0];
    if (row.patientId) {
      if (row.patientId !== patientId) throw new BadRequestException(code);
      await this.ensurePatientAccess(row.patientId, userId);
    } else if (row.createdByUserId !== userId) {
      throw new BadRequestException(code);
    }
    return { path: row.path, contentType: row.contentType };
  }

  async getForStream(id: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(fileAssets).where(eq(fileAssets.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('FILE_NOT_FOUND');
    const row = rows[0];
    if (row.patientId) {
      await this.ensurePatientAccess(row.patientId, userId);
    } else if (row.createdByUserId !== userId) {
      // No patient to gate on (a theoretical unattached upload) — fall back to creator-only,
      // and don't distinguish "not yours" from "doesn't exist" (api.md → access control).
      throw new NotFoundException('FILE_NOT_FOUND');
    }
    return {
      stream: this.storage.createReadStream(row.path),
      contentType: row.contentType,
    };
  }
}
