import { Body, Controller, Get, Patch, Query, Request, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@Request() req: any) {
    return { user: await this.users.getProfile(req.user.userId) };
  }

  @Patch('me')
  async updateMe(@Request() req: any, @Body() dto: UpdateUserDto) {
    const user = await this.users.updateProfile(req.user.userId, dto);
    return { user };
  }

  @Get('search')
  async search(@Query('email') email: string) {
    return await this.users.searchByEmail(email);
  }
}
