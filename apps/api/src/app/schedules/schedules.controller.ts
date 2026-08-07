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
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { LogScheduleDto } from './dto/log-schedule.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post('patients/:patientId/schedules')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return await this.schedules.create(patientId, req.user.userId, dto);
  }

  @Get('patients/:patientId/schedules')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('episodeId') episodeId?: string,
  ) {
    return await this.schedules.listForPatient(patientId, req.user.userId, { type, status, episodeId });
  }

  @Get('schedules/:id')
  async get(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.schedules.get(id, req.user.userId);
  }

  @Patch('schedules/:id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return await this.schedules.update(id, req.user.userId, dto);
  }

  @Post('schedules/:id/log')
  async log(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: LogScheduleDto,
  ) {
    return await this.schedules.log(id, req.user.userId, dto);
  }
}
