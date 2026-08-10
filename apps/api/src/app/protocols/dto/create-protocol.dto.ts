import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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

  // Coarse guard only: the plausible range depends on triggerMetric (0-10 for pain_score, 0-100
  // for oxygen_saturation, 25-45 for a canonical-Celsius temperature). A per-metric constraint is
  // the real answer if protocols get more use; this at least keeps negatives and absurdities out.
  @IsNumber()
  @Min(0)
  @Max(400)
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
