import { Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { WhatsNewService } from './whats-new.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class WhatsNewController {
  constructor(private readonly whatsNew: WhatsNewService) {}

  @Get('patients/:patientId/whats-new')
  async get(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.whatsNew.getWhatsNew(patientId, req.user.userId);
  }

  @Post('patients/:patientId/whats-new/ack')
  async ack(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.whatsNew.ack(patientId, req.user.userId);
  }
}
