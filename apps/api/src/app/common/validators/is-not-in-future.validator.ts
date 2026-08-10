import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/**
 * Rejects an ISO datetime that is later than the server's clock.
 *
 * Applies to fields naming something that *already happened* — `dateOfBirth`, `observedAt`,
 * `performedAt`, `occurredAt` (api.md → Conventions). A single mistyped year is otherwise
 * permanent and unfixable from the UI: a dose stamped 2030 pins the dashboard's "last dose"
 * forever, which is the exact question the app exists to answer.
 *
 * Deliberately NOT applied to planning fields — a schedule's `startAt`/`endAt` describe a course
 * that hasn't happened yet, an embodiment's past `expiresAt` is the *warning* condition, and
 * `POST /api/dose-checks` is a preview that persists nothing.
 *
 * Strict against the clock, with no tolerance. Latency works in the client's favour (a
 * client-stamped time is always older by the time the server sees it), so the only realistic way to
 * trip this is a client clock running fast.
 */
@ValidatorConstraint({ name: 'isNotInFuture', async: false })
export class IsNotInFutureConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    // Absent values belong to @IsOptional, and unparseable ones to @IsDateString. Passing both
    // through keeps one mistake to one message, rather than stacking a second complaint on top of
    // the accurate one.
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return true;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return true;
    return parsed.getTime() <= Date.now();
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'DATE_IN_FUTURE';
  }
}

export function IsNotInFuture(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNotInFutureConstraint,
    });
  };
}
