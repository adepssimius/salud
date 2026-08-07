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
      occurredAt,
    });

    const reasons: string[] = [];
    if (evaluation.exceedsMaxPerDose) reasons.push('exceeds_max_per_dose');
    if (evaluation.exceedsMaxPerDay) reasons.push('exceeds_max_per_day');
    if (evaluation.intervalTooShort) reasons.push('interval_too_short');

    const advisories: AdvisoryCandidate[] = [...evaluation.advisories];
    if (reasons.length) {
      const guidelineId = evaluation.guidance.weightBased?.guidelineId ?? evaluation.guidance.ageBand?.guidelineId;
      advisories.push({
        type: 'atypical_dose',
        severity: 'warning',
        ...(guidelineId ? { sourceType: 'guideline', sourceId: guidelineId } : {}),
        payload: { reasons, amountMg: dto.amountMg ?? null, dailyTotalMg: evaluation.dailyTotalMg },
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
