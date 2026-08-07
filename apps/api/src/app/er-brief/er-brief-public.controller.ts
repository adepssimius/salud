import { Controller, Get, Param } from '@nestjs/common';
import { ErBriefService } from './er-brief.service';

// Deliberately unauthenticated — see security.md → "ER Brief snapshot tokens". Kept in its own
// controller, isolated from every guarded route, the same pattern used for auth/login|register.
@Controller()
export class ErBriefPublicController {
  constructor(private readonly erBrief: ErBriefService) {}

  @Get('er-brief/shared/:token')
  async getShared(@Param('token') token: string) {
    return await this.erBrief.getShared(token);
  }
}
