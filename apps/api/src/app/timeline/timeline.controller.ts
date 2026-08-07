import { Controller, Get, Param, ParseUUIDPipe, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TimelineService } from './timeline.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get('patients/:patientId/timeline')
  async getTimeline(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('episodeId') episodeId?: string,
    @Query('includeObservations') includeObservations?: string,
    @Query('includeInterventions') includeInterventions?: string,
    @Query('medicationTag') medicationTag?: string,
    @Query('medicationId') medicationId?: string,
  ) {
    return await this.timeline.getTimeline(patientId, req.user.userId, {
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      episodeId,
      includeObservations: includeObservations === undefined ? undefined : includeObservations !== 'false',
      includeInterventions: includeInterventions === undefined ? undefined : includeInterventions !== 'false',
      medicationTag,
      medicationId,
    });
  }

  @Get('dashboard')
  async getDashboard(@Request() req: any) {
    return await this.timeline.getDashboard(req.user.userId);
  }
}
