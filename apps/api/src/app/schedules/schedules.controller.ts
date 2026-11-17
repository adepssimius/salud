import {
  Body,
  Controller,
  Delete,
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
import { UpdateScheduleDosesDto } from './dto/update-schedule-doses.dto';
import { SkipScheduleDoseDto } from './dto/skip-schedule-dose.dto';

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

  @Get('schedules/:id/doses')
  async doses(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.schedules.doses(id, req.user.userId);
  }

  @Post('schedules/:id/doses')
  async updateDoses(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateScheduleDosesDto,
  ) {
    return await this.schedules.updateDoses(id, req.user.userId, dto);
  }

  // Missed doses (api.md → Intervention schedules → "Missed doses").
  @Post('schedules/:id/skips')
  async skip(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SkipScheduleDoseDto,
  ) {
    return await this.schedules.skip(id, req.user.userId, dto);
  }

  @Get('schedules/:id/skips')
  async listSkips(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.schedules.listSkips(id, req.user.userId);
  }

  @Delete('schedules/:id/skips/:skipId')
  async unskip(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('skipId', new ParseUUIDPipe({ version: '4' })) skipId: string,
  ) {
    return await this.schedules.unskip(id, skipId, req.user.userId);
  }
}
