import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import {
  CreateProtocolDto as CreateProtocolDtoShape,
  ProtocolTriggerMetric,
  ProtocolTriggerOperator,
} from '@salud/shared/types';

const TRIGGER_METRICS = ['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score'];

export class CreateProtocolDto implements CreateProtocolDtoShape {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(TRIGGER_METRICS)
  triggerMetric!: ProtocolTriggerMetric;

  @IsIn(['gte', 'lte'])
  triggerOperator!: ProtocolTriggerOperator;

  @IsNumber()
  triggerValue!: number;

  @IsString()
  @IsNotEmpty()
  instructionText!: string;

  @IsString()
  @IsNotEmpty()
  sourceText!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
