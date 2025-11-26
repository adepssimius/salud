import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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

@Controller('users/:userId/patients')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly careTeam: CareTeamService,
  ) {}

  @Post()
  async create(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() dto: CreatePatientDto,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.patients.create(dto, userId);
  }

  @Get()
  async list(@Request() req: any, @Param('userId') userId: string) {
    this.assertUser(req.user.userId, userId);
    return await this.patients.listForUser(userId);
  }

  @Get(':id')
  async get(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.patients.get(id, userId);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.patients.update(id, userId, dto);
  }

  @Delete(':id')
  async delete(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.patients.remove(id, userId);
  }

  private assertUser(requesterId: string, paramUserId: string) {
    if (requesterId !== paramUserId) {
      throw new ForbiddenException('USER_FORBIDDEN');
    }
  }

  @Get(':id/care-team')
  async listCareTeam(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.careTeam.list(id, userId);
  }

  @Post(':id/care-team')
  async addCaregiver(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AddCaregiverDto,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.careTeam.add(id, userId, dto.userId, dto.role);
  }

  @Delete(':id/care-team/:caregiverId')
  async removeCaregiver(
    @Request() req: any,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('caregiverId', new ParseUUIDPipe({ version: '4' })) caregiverId: string,
  ) {
    this.assertUser(req.user.userId, userId);
    return await this.careTeam.remove(id, userId, caregiverId);
  }
}
