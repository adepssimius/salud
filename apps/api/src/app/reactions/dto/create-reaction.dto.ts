import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  CreateReactionDto as CreateReactionDtoShape,
  ReactionScopeType,
  ReactionSeverity,
} from '@salud/shared/types';

export class CreateReactionDto implements CreateReactionDtoShape {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsDateString()
  occurredAt!: string;

  @IsIn(['warning', 'danger'])
  severity!: ReactionSeverity;

  @IsIn(['embodiment', 'medication', 'tag'])
  scopeType!: ReactionScopeType;

  @IsOptional()
  @IsUUID('4')
  medicationId?: string;

  @IsOptional()
  @IsUUID('4')
  embodimentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  tag?: string;
}
