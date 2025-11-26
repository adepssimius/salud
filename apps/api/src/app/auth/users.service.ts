import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { users } from '../../db/schema';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getProfile(userId: string) {
    const db = this.db.db as any;
    const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!found.length) throw new NotFoundException('USER_NOT_FOUND');
    return this.pickProfile(found[0]);
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.displayName) updates.displayName = dto.displayName;
    if (dto.preferredTempUnit) updates.preferredTempUnit = dto.preferredTempUnit;
    if (dto.preferredLengthUnit) updates.preferredLengthUnit = dto.preferredLengthUnit;
    if (dto.preferredWeightUnit) updates.preferredWeightUnit = dto.preferredWeightUnit;

    if (Object.keys(updates).length === 0) {
      return this.getProfile(userId);
    }

    await db.update(users).set(updates).where(eq(users.id, userId));
    const updated = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return this.pickProfile(updated[0]);
  }

  private pickUser(user: any) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  private pickProfile(user: any) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preferredTempUnit: user.preferredTempUnit,
      preferredLengthUnit: user.preferredLengthUnit,
      preferredWeightUnit: user.preferredWeightUnit,
    };
  }

  async searchByEmail(email: string) {
    const db = this.db.db as any;
    const results = await db.select().from(users).where(eq(users.email, email)).limit(5);
    return results.map((u: any) => this.pickUser(u));
  }
}
