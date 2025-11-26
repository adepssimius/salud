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

@Controller('users/:userId/patients')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

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
}
