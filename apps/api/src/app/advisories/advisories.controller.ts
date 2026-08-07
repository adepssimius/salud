import { Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AdvisoriesService } from './advisories.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AdvisoriesController {
  constructor(private readonly advisories: AdvisoriesService) {}

  @Get('patients/:patientId/advisories')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.advisories.listForPatient(patientId, req.user.userId);
  }

  @Post('advisories/:id/ack')
  async ack(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return await this.advisories.ack(id, req.user.userId);
  }
}
