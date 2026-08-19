import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CHART_OVERLAY_KINDS, ChartOverlayKind, SetChartOverlayDefaultsDto } from '@salud/shared/types';

// Which dose markers a metric's chart shows by default (api.md → "Chart overlay defaults").
// Only `medication_tag` ships in Phase 1; `value` is deliberately unconstrained beyond a length
// cap, since a tag no medication carries yet is a legitimate thing to configure ahead of time.
class ChartOverlayEntryDto {
  @IsIn(CHART_OVERLAY_KINDS as readonly string[])
  kind!: ChartOverlayKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  value!: string;
}

export class SetChartOverlayDefaultsBodyDto implements SetChartOverlayDefaultsDto {
  // An empty array is valid and meaningful: it clears the metric's defaults.
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChartOverlayEntryDto)
  overlays!: ChartOverlayEntryDto[];
}
