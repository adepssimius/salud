import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import {
  ProtocolTriggerMetric,
  ProtocolTriggerOperator,
  UpdateProtocolDto as UpdateProtocolDtoShape,
} from '@salud/shared/types';

const TRIGGER_METRICS = ['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score'];

export class UpdateProtocolDto implements UpdateProtocolDtoShape {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(TRIGGER_METRICS)
  triggerMetric?: ProtocolTriggerMetric;

  @IsOptional()
  @IsIn(['gte', 'lte'])
  triggerOperator?: ProtocolTriggerOperator;

  @IsOptional()
  @IsNumber()
  triggerValue?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instructionText?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sourceText?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
