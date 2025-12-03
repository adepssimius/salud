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
import { InterventionsService } from './interventions.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import { UpdateInterventionDto } from './dto/update-intervention.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class InterventionsController {
  constructor(private readonly interventions: InterventionsService) {}

  @Post('patients/:patientId/interventions')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateInterventionDto,
  ) {
    return await this.interventions.create(patientId, req.user.userId, dto);
  }

  @Get('patients/:patientId/interventions')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('type') type?: string,
    @Query('episodeId') episodeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('medicationId') medicationId?: string,
  ) {
    return await this.interventions.list(patientId, req.user.userId, {
      type,
      episodeId,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      medicationId,
    });
  }

  @Get('patients/:patientId/interventions/:id')
  async getForPatient(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.interventions.get(id, req.user.userId, patientId);
  }

  @Get('interventions/:id')
  async get(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.interventions.get(id, req.user.userId);
  }

  @Patch('interventions/:id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateInterventionDto,
  ) {
    return await this.interventions.update(id, req.user.userId, dto);
  }
}
