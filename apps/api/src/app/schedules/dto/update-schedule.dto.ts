import { MISSED_DOSE_ACTIONS, MISSED_DOSE_COURSE_EFFECTS, MissedDoseAction, MissedDoseCourseEffect } from '@salud/shared/types';
import { MaxLength, ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { InterventionType, ScheduleStatus, UpdateScheduleDto as UpdateScheduleShape } from '@salud/shared/types';

// Any subset of the create fields; null clears an optional one (api.md → Intervention schedules →
// "Editing a schedule"). @IsOptional lets null through, so each nullable field is written as given.
export class UpdateScheduleDto implements UpdateScheduleShape {
  // Only while no dose is linked — SchedulesService.update, 409 SCHEDULE_HAS_DOSES.
  @IsOptional()
  @IsIn(['medication_dose', 'dressing_change'] satisfies InterventionType[])
  type?: InterventionType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  // No @IsNotInFuture, as on create: a course may start in the future.
  @IsOptional()
  @IsDateString()
  startAt?: string;

  // The episodes the schedule treats (data-model.md → ScheduleEpisode); replaces the list whole.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  episodeIds?: string[] | null;

  @IsOptional()
  @IsString()
  conditionId?: string | null;

  @IsOptional()
  @IsString()
  medicationId?: string | null;

  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  doseMg?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  doseMl?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(100)
  pillCount?: number | null;

  @IsOptional()
  @IsString()
  bodyLocation?: string | null;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a' | null;

  @IsOptional()
  @IsString()
  dressingType?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(8760)
  frequencyHours?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  explicitTimes?: string[] | null;

  // IANA zone (e.g. "America/Chicago") the explicitTimes are wall-clock times in. The web sends
  // the browser's zone; an unknown zone is rejected in the service as INVALID_TIME_ZONE so the
  // code reaches the user rather than a generic validation message.
  @IsOptional()
  @IsString()
  timeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  endAfterOccurrences?: number | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsIn(['active', 'paused', 'completed'] satisfies ScheduleStatus[])
  status?: ScheduleStatus;

  // The missed-dose instruction (api.md → Intervention schedules → "Missed doses"). null clears it.
  @IsOptional()
  @IsIn(MISSED_DOSE_ACTIONS)
  missedDoseAction?: MissedDoseAction | null;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(168)
  missedDoseCutoffHours?: number | null;

  @IsOptional()
  @IsIn(MISSED_DOSE_COURSE_EFFECTS)
  missedDoseCourseEffect?: MissedDoseCourseEffect | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  missedDoseNote?: string | null;
}
