import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EpisodeFramingService } from './episode-framing.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateEpisodeEventsDto } from './dto/update-episode-events.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class EpisodeFramingController {
  constructor(private readonly framing: EpisodeFramingService) {}

  @Post('patients/:patientId/episodes')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateEpisodeDto,
  ) {
    return this.framing.create(patientId, req.user.userId, dto);
  }

  @Post('episodes/:episodeId/events')
  @HttpCode(200)
  async updateEvents(
    @Request() req: any,
    @Param('episodeId', new ParseUUIDPipe({ version: '4' })) episodeId: string,
    @Body() dto: UpdateEpisodeEventsDto,
  ) {
    return this.framing.updateEvents(episodeId, req.user.userId, dto);
  }
}
