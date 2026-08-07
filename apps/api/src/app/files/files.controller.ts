import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { FilesService } from './files.service';

// @types/multer isn't installed; memoryStorage() populates exactly this shape on req.file, so a
// minimal local interface avoids pulling in the full ambient Express.Multer.File type for one field set.
interface UploadedMulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@Request() req: any, @UploadedFile() file: UploadedMulterFile) {
    const patientId = req.body?.patientId;
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    if (!patientId) throw new BadRequestException('PATIENT_ID_REQUIRED');
    return await this.files.upload(req.user.userId, patientId, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Get('files/:id')
  async get(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, contentType } = await this.files.getForStream(id, req.user.userId);
    res.set({ 'Content-Type': contentType });
    return new StreamableFile(stream);
  }
}
