import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AnalytesService } from './analytes.service';
import { CreateAnalyteDto } from './dto/create-analyte.dto';
import { UpdateAnalyteDto } from './dto/update-analyte.dto';
import { CreateReferenceRangeDto } from './dto/create-reference-range.dto';
import { UpdateReferenceRangeDto } from './dto/update-reference-range.dto';
import { UpsertAnalyteGoalDto } from './dto/upsert-analyte-goal.dto';
import { ResolveAnalytesDto } from './dto/resolve-analytes.dto';

// Paths written out in full (medications-controller style) so the reference-range and goal routes
// sit at their natural top level rather than nested under a controller prefix. The analyte routes
// are household-global; goals and history are patient-scoped and access-checked in the service.
@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AnalytesController {
  constructor(private readonly analytes: AnalytesService) {}

  @Post('analytes')
  async create(@Body() dto: CreateAnalyteDto) {
    return await this.analytes.create(dto);
  }

  @Get('analytes')
  async list(@Query('q') q?: string) {
    return await this.analytes.list({ q });
  }

  // Declared before `analytes/:id` for readability; Nest matches the literal path first regardless.
  @Post('analytes/resolve')
  async resolve(@Body() dto: ResolveAnalytesDto) {
    return await this.analytes.resolve(dto.analytes);
  }

  @Get('analytes/:id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.analytes.get(id);
  }

  @Patch('analytes/:id')
  async update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UpdateAnalyteDto) {
    return await this.analytes.update(id, dto);
  }

  @Delete('analytes/:id')
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.analytes.remove(id);
  }

  @Post('analytes/:id/reference-ranges')
  async createRange(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateReferenceRangeDto,
  ) {
    return await this.analytes.createRange(id, dto);
  }

  @Get('analytes/:id/reference-ranges')
  async listRanges(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.analytes.listRanges(id);
  }

  @Patch('reference-ranges/:id')
  async updateRange(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateReferenceRangeDto,
  ) {
    return await this.analytes.updateRange(id, dto);
  }

  @Delete('reference-ranges/:id')
  async removeRange(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.analytes.removeRange(id);
  }

  @Get('patients/:patientId/analyte-goals')
  async listGoals(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.analytes.listGoals(patientId, req.user.userId);
  }

  @Put('patients/:patientId/analyte-goals/:analyteId')
  async upsertGoal(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('analyteId', new ParseUUIDPipe({ version: '4' })) analyteId: string,
    @Body() dto: UpsertAnalyteGoalDto,
  ) {
    return await this.analytes.upsertGoal(patientId, analyteId, req.user.userId, dto);
  }

  @Delete('patients/:patientId/analyte-goals/:analyteId')
  async removeGoal(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('analyteId', new ParseUUIDPipe({ version: '4' })) analyteId: string,
  ) {
    return await this.analytes.removeGoal(patientId, analyteId, req.user.userId);
  }

  @Get('patients/:patientId/analytes/:analyteId/history')
  async history(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('analyteId', new ParseUUIDPipe({ version: '4' })) analyteId: string,
  ) {
    return await this.analytes.history(patientId, analyteId, req.user.userId);
  }
}
