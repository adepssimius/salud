import { Injectable, NotFoundException } from '@nestjs/common';
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
