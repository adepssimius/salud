import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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
  // Coarse guard only: the plausible range depends on triggerMetric (0-10 for pain_score, 0-100
  // for oxygen_saturation, 25-45 for a canonical-Celsius temperature). A per-metric constraint is
  // the real answer if protocols get more use; this at least keeps negatives and absurdities out.
  @IsNumber()
  @Min(0)
  @Max(400)
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
