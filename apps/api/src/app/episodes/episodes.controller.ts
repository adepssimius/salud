import { Controller, Get, Param, ParseUUIDPipe, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EpisodesService } from './episodes.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get('patients/:patientId/episodes')
  async listForPatient(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Query('status') status?: 'active' | 'resolved',
  ) {
    return this.episodes.listForPatient(patientId, req.user.userId, status === 'resolved' ? 'resolved' : status === 'active' ? 'active' : undefined);
  }

  @Get('episodes/active')
  async listActive(@Request() req: any) {
    return this.episodes.listActiveForUser(req.user.userId);
  }

  // Must be declared after 'episodes/active' — NestJS matches routes in
  // declaration order, and ':episodeId' would otherwise swallow 'active'.
  @Get('episodes/:episodeId')
  async getById(
    @Request() req: any,
    @Param('episodeId', new ParseUUIDPipe({ version: '4' })) episodeId: string,
  ) {
    return this.episodes.getById(episodeId, req.user.userId);
  }
}
