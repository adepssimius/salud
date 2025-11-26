import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../persistence/database.service';
import { users } from '../../db/schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const db = this.db.db as any;
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (existing.length) {
      throw new ConflictException('EMAIL_TAKEN');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const id = randomUUID();
    const prefs = this.applyDefaults(dto);

    await db.insert(users).values({
      id,
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
      preferredTempUnit: prefs.preferredTempUnit,
      preferredLengthUnit: prefs.preferredLengthUnit,
      preferredWeightUnit: prefs.preferredWeightUnit,
    });

    return this.issueToken({
      id,
      email: dto.email,
      displayName: dto.displayName,
      ...prefs,
    });
  }

  async login(dto: LoginDto) {
    const db = this.db.db as any;
    const found = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (!found.length) throw new UnauthorizedException('INVALID_CREDENTIALS');

    const user = found[0];
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('INVALID_CREDENTIALS');

    return this.issueToken(this.pickUser(user));
  }

  async me(userId: string) {
    const db = this.db.db as any;
    const found = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!found.length) {
      throw new UnauthorizedException('USER_NOT_FOUND');
    }
    return { user: this.pickUser(found[0]) };
  }

  private applyDefaults(dto: RegisterDto) {
    return {
      preferredTempUnit: dto.preferredTempUnit ?? 'F',
      preferredLengthUnit: dto.preferredLengthUnit ?? 'cm',
      preferredWeightUnit: dto.preferredWeightUnit ?? 'kg',
    };
  }

  private issueToken(user: {
    id: string;
    email: string;
    displayName: string;
    preferredTempUnit: 'C' | 'F';
    preferredLengthUnit: 'cm' | 'in';
    preferredWeightUnit: 'kg' | 'lb' | 'st';
  }) {
    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
    });
    return { token, user };
  }

  private pickUser(user: any) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preferredTempUnit: user.preferredTempUnit,
      preferredLengthUnit: user.preferredLengthUnit,
      preferredWeightUnit: user.preferredWeightUnit,
    };
  }
}
