import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ReactionsService } from './reactions.service';
import { CreateReactionDto } from './dto/create-reaction.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  @Post('patients/:patientId/reactions')
  async create(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() dto: CreateReactionDto,
  ) {
    return await this.reactions.create(patientId, req.user.userId, dto);
  }

  @Get('patients/:patientId/reactions')
  async list(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ) {
    return await this.reactions.listForPatient(patientId, req.user.userId);
  }

  @Delete('patients/:patientId/reactions/:reactionId')
  async remove(
    @Request() req: any,
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Param('reactionId', new ParseUUIDPipe({ version: '4' })) reactionId: string,
  ) {
    return await this.reactions.remove(patientId, reactionId, req.user.userId);
  }
}
