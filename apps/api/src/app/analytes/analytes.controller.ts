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
import { CreateAnalyteRangeDto } from './dto/create-analyte-range.dto';
import { UpdateAnalyteRangeDto } from './dto/update-analyte-range.dto';
import { ResolveAnalytesDto } from './dto/resolve-analytes.dto';
import { SetChartOverlayDefaultsBodyDto } from './dto/set-chart-overlay-defaults.dto';

// Paths written out in full (medications-controller style) so the by-id range routes sit at their
// natural top level rather than nested under a controller prefix. The analyte routes themselves
// are household-global; ranges and history are patient-scoped and access-checked in the service.
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
  async list(@Query('q') q?: string, @Query('kind') kind?: string) {
    // Anything unrecognised falls back to the default rather than 400ing: this is a listing filter,
    // and a typo should show the ordinary catalog, not fail the page.
    const parsed = kind === 'vital' || kind === 'all' || kind === 'lab' ? kind : undefined;
    return await this.analytes.list({ q, kind: parsed });
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

  // Household-global like the analyte itself: which dose markers this metric's chart shows by
  // default. Declared before the patient-scoped range routes to keep the analyte-global surface
  // together.
  @Get('analytes/:id/chart-defaults')
  async chartDefaults(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.analytes.listChartDefaults(id);
  }

  @Put('analytes/:id/chart-defaults')
  async setChartDefaults(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetChartOverlayDefaultsBodyDto,
  ) {
    return await this.analytes.setChartDefaults(id, dto);
  }

  @Post('patients/:patientId/analytes/:analyteId/ranges')
  async createRange(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('analyteId', new ParseUUIDPipe({ version: '4' })) analyteId: string,
    @Body() dto: CreateAnalyteRangeDto,
  ) {
    return await this.analytes.createRange(patientId, analyteId, req.user.userId, dto);
  }

  @Get('patients/:patientId/analytes/:analyteId/ranges')
  async listRanges(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('analyteId', new ParseUUIDPipe({ version: '4' })) analyteId: string,
  ) {
    return await this.analytes.listRanges(patientId, analyteId, req.user.userId);
  }

  // By id: the row names its own patient, so membership is checked from the row rather than the
  // path, and a non-member gets the same 404 an unknown id gets.
  @Patch('analyte-ranges/:id')
  async updateRange(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAnalyteRangeDto,
  ) {
    return await this.analytes.updateRange(id, req.user.userId, dto);
  }

  @Delete('analyte-ranges/:id')
  async removeRange(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.analytes.removeRange(id, req.user.userId);
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
