import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ProtocolsService } from './protocols.service';
import { CreateProtocolDto } from './dto/create-protocol.dto';
import { UpdateProtocolDto } from './dto/update-protocol.dto';

@Controller()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ProtocolsController {
  constructor(private readonly protocols: ProtocolsService) {}

  @Post('conditions/:conditionId/protocols')
  async create(
    @Request() req: any,
    @Param('conditionId', new ParseUUIDPipe({ version: '4' })) conditionId: string,
    @Body() dto: CreateProtocolDto,
  ) {
    return await this.protocols.create(conditionId, req.user.userId, dto);
  }

  @Get('conditions/:conditionId/protocols')
  async list(
    @Request() req: any,
    @Param('conditionId', new ParseUUIDPipe({ version: '4' })) conditionId: string,
  ) {
    return await this.protocols.listForCondition(conditionId, req.user.userId);
  }

  @Get('protocols/:id')
  async get(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.protocols.get(id, req.user.userId);
  }

  @Patch('protocols/:id')
  async update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProtocolDto,
  ) {
    return await this.protocols.update(id, req.user.userId, dto);
  }

  @Delete('protocols/:id')
  async remove(@Request() req: any, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.protocols.remove(id, req.user.userId);
  }
}
