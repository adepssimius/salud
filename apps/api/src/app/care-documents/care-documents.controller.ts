import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CareDocumentKind } from '@salud/shared/types';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CareDocumentsService } from './care-documents.service';
import { SetCareDocumentDto } from './dto/set-care-document.dto';
import { ParseCareDocumentKindPipe } from './parse-care-document-kind.pipe';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CareDocumentsController {
  constructor(private readonly careDocuments: CareDocumentsService) {}

  @Get('patients/:patientId/care-documents')
  async get(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.careDocuments.getMap(patientId, req.user.userId);
  }

  // PUT, not PATCH: the body states the whole current position for one kind, and the write
  // appends a new statement rather than editing one (data-model.md → CareDocumentStatement).
  @Put('patients/:patientId/care-documents/:kind')
  async set(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('kind', ParseCareDocumentKindPipe) kind: CareDocumentKind,
    @Body() dto: SetCareDocumentDto,
  ) {
    return await this.careDocuments.set(patientId, kind, req.user.userId, dto);
  }

  @Get('patients/:patientId/care-documents/:kind/history')
  async history(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('kind', ParseCareDocumentKindPipe) kind: CareDocumentKind,
  ) {
    return await this.careDocuments.getHistory(patientId, kind, req.user.userId);
  }
}
