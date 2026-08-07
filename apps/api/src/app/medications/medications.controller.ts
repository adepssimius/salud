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
import { MedicationsService } from './medications.service';
import { EmbodimentsService } from './embodiments.service';
import { GuidelinesService } from './guidelines.service';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { CreateEmbodimentDto } from './dto/create-embodiment.dto';
import { UpdateEmbodimentDto } from './dto/update-embodiment.dto';
import { CreateGuidelineDto } from './dto/create-guideline.dto';
import { UpdateGuidelineDto } from './dto/update-guideline.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MedicationsController {
  constructor(
    private readonly medications: MedicationsService,
    private readonly embodiments: EmbodimentsService,
    private readonly guidelines: GuidelinesService,
  ) {}

  @Post('medications')
  async create(@Body() dto: CreateMedicationDto) {
    return await this.medications.create(dto);
  }

  @Get('medications')
  async list(
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return await this.medications.list({ q, tag, activeOnly: activeOnly === 'true' });
  }

  @Get('medications/:id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.medications.get(id);
  }

  @Patch('medications/:id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMedicationDto,
  ) {
    return await this.medications.update(id, dto);
  }

  @Delete('medications/:id')
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.medications.remove(id);
  }

  @Post('medications/:id/embodiments')
  async createEmbodiment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) medicationId: string,
    @Body() dto: CreateEmbodimentDto,
  ) {
    return await this.embodiments.create(medicationId, dto);
  }

  @Get('medications/:id/embodiments')
  async listEmbodiments(@Param('id', new ParseUUIDPipe({ version: '4' })) medicationId: string) {
    return await this.embodiments.listForMedication(medicationId);
  }

  @Patch('embodiments/:id')
  async updateEmbodiment(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateEmbodimentDto,
  ) {
    return await this.embodiments.update(id, req.user.userId, dto);
  }

  @Delete('embodiments/:id')
  async removeEmbodiment(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.embodiments.remove(id);
  }

  @Post('embodiments/:id/restock')
  async restockEmbodiment(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.embodiments.update(id, req.user.userId, { runningLow: false });
  }

  @Post('medications/:id/guidelines')
  async createGuideline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) medicationId: string,
    @Body() dto: CreateGuidelineDto,
  ) {
    return await this.guidelines.create(medicationId, dto);
  }

  @Get('medications/:id/guidelines')
  async listGuidelines(@Param('id', new ParseUUIDPipe({ version: '4' })) medicationId: string) {
    return await this.guidelines.listForMedication(medicationId);
  }

  @Get('guidelines/:id')
  async getGuideline(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.guidelines.get(id);
  }

  @Patch('guidelines/:id')
  async updateGuideline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateGuidelineDto,
  ) {
    return await this.guidelines.update(id, dto);
  }

  @Delete('guidelines/:id')
  async removeGuideline(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.guidelines.remove(id);
  }
}
