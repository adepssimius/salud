import { Body, Controller, Param, ParseUUIDPipe, Post, Request, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DosingService } from './dosing.service';
import { DoseCheckDto } from './dto/dose-check.dto';
import { AdvisoryCandidate } from '@salud/shared/types';

@Controller('patients/:patientId/dose-checks')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class DosingController {
  constructor(private readonly dosing: DosingService) {}

  @Post()
  async check(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: DoseCheckDto,
  ) {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const evaluation = await this.dosing.evaluate(patientId, req.user.userId, {
      medicationId: dto.medicationId,
      embodimentId: dto.medicationEmbodimentId,
      amountMg: dto.amountMg,
      amountMl: dto.amountMl,
      pillCount: dto.pillCount,
      occurredAt,
      excludeInterventionId: dto.excludeInterventionId,
    });

    // The same verdict and payload the save writes (DosingService.atypicalPayload).
    const advisories: AdvisoryCandidate[] = [...evaluation.advisories];
    const payload = DosingService.atypicalPayload(evaluation);
    if (payload) {
      const guidelineId = evaluation.guidance.weightBased?.guidelineId ?? evaluation.guidance.ageBand?.guidelineId;
      advisories.push({
        type: 'atypical_dose',
        severity: 'warning',
        ...(guidelineId ? { sourceType: 'guideline', sourceId: guidelineId } : {}),
        payload,
      });
    }

    return {
      guidance: evaluation.guidance,
      nextAllowedAt: evaluation.nextAllowedAt,
      dailyTotalMg: evaluation.dailyTotalMg ?? evaluation.dailyTotalMgBefore,
      advisories,
    };
  }
}
