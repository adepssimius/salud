import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ErBriefService } from './er-brief.service';

// Deliberately unauthenticated — see security.md → "ER Brief snapshot tokens". Kept in its own
// controller, isolated from every guarded route, the same pattern used for auth/login|register.
@Controller()
export class ErBriefPublicController {
  constructor(private readonly erBrief: ErBriefService) {}

  @Get('er-brief/shared/:token')
  async getShared(@Param('token') token: string) {
    return await this.erBrief.getShared(token);
  }

  // Care-document files frozen into the snapshot, and only those. A clinician opening a shared
  // brief has no account to authenticate with, so the token is the whole capability — scoped to
  // the ids pinned at freeze time rather than to the patient's files at large.
  @Get('er-brief/shared/:token/files/:fileId')
  async getSharedFile(
    @Param('token') token: string,
    @Param('fileId', new ParseUUIDPipe({ version: '4' })) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, contentType } = await this.erBrief.getSharedFile(token, fileId);
    res.set({ 'Content-Type': contentType });
    return new StreamableFile(stream);
  }
}
