import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Throws 400 `FIELD_NOT_CORRECTABLE`, carrying the offending `fields`, when a correction body
 * names a field a correction may not change (api.md → both correction `PATCH` sections). The body
 * shape matches `RESERVED_METADATA_KEY`'s `{ message, keys }` — `FieldNotCorrectableError` in the
 * shared types.
 *
 * Detected by key presence on the RAW body, never on the validated DTO: the controllers'
 * `ValidationPipe({ whitelist: true })` strips undeclared keys, so a check on the DTO could never
 * see `type` or `unitPreferenceAtEntry` and the request would "succeed" while silently ignoring
 * them — exactly what the spec rules out. Rejected rather than stripped for the same reason as
 * RESERVED_METADATA_KEY: a client sending them believes they will be applied.
 *
 * `forbiddenValues` covers a field that is correctable except for some values
 * (`doseSource: 'schedule'`); the field name is what `fields` reports.
 */
export function assertCorrectable(
  body: unknown,
  fixed: readonly string[],
  forbiddenValues: Readonly<Record<string, readonly unknown[]>> = {},
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return; // shape is the pipe's job
  const fields: string[] = [];
  for (const key of Object.keys(body)) {
    const value = (body as Record<string, unknown>)[key];
    if (fixed.includes(key) || forbiddenValues[key]?.includes(value)) fields.push(key);
  }
  if (fields.length) throw new BadRequestException({ message: 'FIELD_NOT_CORRECTABLE', fields });
}

/**
 * Runs `assertCorrectable` on the raw request body. An interceptor rather than a pipe because
 * interceptors run before pipes: the controller-level ValidationPipe would otherwise reject
 * `doseSource: 'schedule'` with class-validator prose (the update DTO's `@IsIn` lists only the
 * correctable sources) before the specific code could fire. Runs after the JWT guard, and before
 * the patient lookup — the verdict depends on the body alone, so it discloses nothing about
 * whether the entry exists.
 */
@Injectable()
export class CorrectionFieldsInterceptor implements NestInterceptor {
  constructor(
    private readonly fixed: readonly string[],
    private readonly forbiddenValues: Readonly<Record<string, readonly unknown[]>> = {},
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    assertCorrectable(context.switchToHttp().getRequest().body, this.fixed, this.forbiddenValues);
    return next.handle();
  }
}

/** api.md → `PATCH /api/observations/:observationId` → "Not correctable". */
export const OBSERVATION_FIXED_FIELDS = [
  'unitPreferenceAtEntry',
  'recordedByUserId',
  'createdAt',
  'startEpisodeName',
  'startEpisodeConditionId',
] as const;

/**
 * api.md → `PATCH /api/interventions/:interventionId` → "Not correctable". The third rule there —
 * any `doseSource` on a dose that is already scheduled — needs the stored row, so
 * InterventionsService enforces it.
 */
export const INTERVENTION_FIXED_FIELDS = [
  'type',
  'interventionScheduleId',
  'recordedByUserId',
  'createdAt',
  'startEpisodeName',
  'startEpisodeConditionId',
] as const;
export const INTERVENTION_FORBIDDEN_VALUES = { doseSource: ['schedule'] } as const;
