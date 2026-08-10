import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ErBriefService } from './er-brief.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { resolveRequestOrigin } from './request-origin';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ErBriefController {
  constructor(private readonly erBrief: ErBriefService) {}

  @Get('patients/:patientId/er-brief')
  async get(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('episodeId') episodeId?: string,
  ) {
    return await this.erBrief.build(patientId, req.user.userId, episodeId);
  }

  @Post('patients/:patientId/er-brief/snapshots')
  async createSnapshot(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateSnapshotDto,
  ) {
    const origin = resolveRequestOrigin(req);
    return await this.erBrief.createSnapshot(patientId, req.user.userId, dto, origin);
  }

  @Get('patients/:patientId/er-brief/snapshots')
  async listSnapshots(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.erBrief.listSnapshots(patientId, req.user.userId);
  }

  @Delete('er-brief/snapshots/:id')
  async revokeSnapshot(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.erBrief.revokeSnapshot(id, req.user.userId);
  }
}
