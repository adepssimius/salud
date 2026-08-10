import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { StorageService } from '../storage/storage.service';
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
      patientId,
      createdByUserId: userId,
    });
    return { fileId: id, url: `/api/files/${id}` };
  }

  /**
   * Write-side check for a photo observation entry's `metadata.fileId`.
   *
   * Same access shape as getForStream above, but it throws PHOTO_FILE_NOT_FOUND (400) rather than
   * FILE_NOT_FOUND (404): this is a bad request body, not a missing resource. One code covers all
   * four failure modes — no such file, another patient's file, someone else's unattached upload —
   * for exactly the reason getForStream doesn't distinguish them either.
   *
   * Catching this at write time rather than at read time is the point: a shape-valid UUID naming
   * nothing is a permanently broken image in the timeline and the ER Brief.
   */
  async assertUsableForPatient(fileId: string, patientId: string, userId: string): Promise<void> {
    const db = this.db.db as any;
    const rows = await db.select().from(fileAssets).where(eq(fileAssets.id, fileId)).limit(1);
    if (!rows.length) throw new BadRequestException('PHOTO_FILE_NOT_FOUND');
    const row = rows[0];
    if (row.patientId) {
      if (row.patientId !== patientId) throw new BadRequestException('PHOTO_FILE_NOT_FOUND');
      await this.ensurePatientAccess(row.patientId, userId);
    } else if (row.createdByUserId !== userId) {
      throw new BadRequestException('PHOTO_FILE_NOT_FOUND');
    }
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
