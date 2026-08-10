import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  CreateReactionDto as CreateReactionDtoShape,
  ReactionScopeType,
  ReactionSeverity,
} from '@salud/shared/types';
import { IsNotInFuture } from '../../common/validators';

export class CreateReactionDto implements CreateReactionDtoShape {
  @IsString()
  @IsNotEmpty()
  description!: string;

  // Optional: a caregiver often knows *that* a child reacted without knowing *when*, and a
  // required date would force a guess into a record §4.9 keeps forever. @IsOptional must come
  // first -- it short-circuits the rest of the chain, so an omitted value skips both checks while
  // a supplied one still has to parse and still can't be in the future.
  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  occurredAt?: string;

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
