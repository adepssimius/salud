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
import { ConditionsService } from './conditions.service';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ConditionsController {
  constructor(private readonly conditions: ConditionsService) {}

  @Post('patients/:patientId/conditions')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateConditionDto,
  ) {
    return await this.conditions.create(patientId, req.user.userId, dto);
  }

  @Get('patients/:patientId/conditions')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('status') status?: 'active' | 'resolved',
  ) {
    return await this.conditions.listForPatient(patientId, req.user.userId, status);
  }

  @Get('conditions/:id')
  async get(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.conditions.get(id, req.user.userId);
  }

  @Patch('conditions/:id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateConditionDto,
  ) {
    return await this.conditions.update(id, req.user.userId, dto);
  }

  @Delete('conditions/:id')
  async remove(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.conditions.remove(id, req.user.userId);
  }

  @Get('conditions/:id/revisions')
  async getRevisions(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.conditions.getRevisions(id, req.user.userId);
  }
}
