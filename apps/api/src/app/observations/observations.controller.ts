import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ObservationsService } from './observations.service';
import { CreateObservationDto } from './dto/create-observation.dto';
import { UpdateObservationDto } from './dto/update-observation.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Post('patients/:patientId/observations')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateObservationDto,
  ) {
    return await this.observations.create(patientId, req.user.userId, dto);
  }

  @Get('patients/:patientId/observations')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('type') type?: string,
    @Query('episodeId') episodeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.observations.list(patientId, req.user.userId, {
      type,
      episodeId,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('patients/:patientId/observations/:id')
  async getForPatient(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.observations.getById(id, req.user.userId, patientId);
  }

  @Get('observations/:id')
  async get(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.observations.getById(id, req.user.userId);
  }

  @Patch('observations/:id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateObservationDto,
  ) {
    return await this.observations.update(id, req.user.userId, dto);
  }

  @Get('observations/:id/revisions')
  async getRevisions(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.observations.getRevisions(id, req.user.userId);
  }
}
