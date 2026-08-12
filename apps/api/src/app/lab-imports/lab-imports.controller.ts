import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { LabImportsService } from './lab-imports.service';
import { CreateLabImportDto } from './dto/create-lab-import.dto';

// Compute-only POST, same shape as dose-checks: 201 with the parse result, nothing persisted.
@Controller('patients/:patientId/lab-imports')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LabImportsController {
  constructor(private readonly labImports: LabImportsService) {}

  @Post()
  async parse(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateLabImportDto,
  ) {
    return await this.labImports.parse(patientId, req.user.userId, dto);
  }
}
