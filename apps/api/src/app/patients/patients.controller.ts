import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { CareTeamService } from './care-team.service';
import { AddCaregiverDto } from './dto/add-caregiver.dto';
import { UpdateCodeStatusDto } from './dto/update-code-status.dto';

@Controller('patients')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly careTeam: CareTeamService,
  ) {}

  @Post()
  async create(@Request() req: any, @Body() dto: CreatePatientDto) {
    return await this.patients.create(dto, req.user.userId);
  }

  @Get()
  async list(@Request() req: any) {
    return await this.patients.listForUser(req.user.userId);
  }

  @Get(':id')
  async get(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.patients.get(id, req.user.userId);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return await this.patients.update(id, req.user.userId, dto);
  }

  @Patch(':id/code-status')
  async updateCodeStatus(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCodeStatusDto,
  ) {
    return await this.patients.updateCodeStatus(id, req.user.userId, dto);
  }

  @Delete(':id')
  async delete(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.patients.remove(id, req.user.userId);
  }

  @Get(':id/care-team')
  async listCareTeam(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.careTeam.list(id, req.user.userId);
  }

  @Post(':id/care-team')
  async addCaregiver(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AddCaregiverDto,
  ) {
    return await this.careTeam.add(id, req.user.userId, dto.userId, dto.role);
  }

  @Delete(':id/care-team/:caregiverId')
  async removeCaregiver(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('caregiverId', new ParseUUIDPipe({ version: '4' })) caregiverId: string,
  ) {
    return await this.careTeam.remove(id, req.user.userId, caregiverId);
  }

  @Get(':id/revisions')
  async getRevisions(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.patients.getRevisions(id, req.user.userId);
  }
}
