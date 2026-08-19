import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/**
 * Enforces the `status`/`fileId` pairing on a care-document statement: a document that is
 * `on_file` must name the file, and a `none` statement must not carry one (api.md → Care
 * documents).
 *
 * A custom constraint rather than stacked `@ValidateIf`s: class-validator skips a property when
 * *any* registered condition is false, so two mutually exclusive `@ValidateIf`s would skip the
 * field in both directions and validate nothing at all.
 *
 * Applied to `status`, not to `fileId`, for the same short-circuiting reason: `fileId` carries
 * `@IsOptional()` for its format check, and that skips every other validator on the property when
 * the value is absent — which is precisely the case this rule has to reject. `status` is always
 * present, so a constraint hung there always runs.
 *
 * The messages are deliberately plain prose, not `SCREAMING_SNAKE_CASE` codes. This is a
 * malformed body from a client that should never have sent it — the web form picks one arm or the
 * other — so it belongs with the other array-form validation failures rather than in the
 * error-code table, where every entry earns a caregiver-facing sentence.
 */
@ValidatorConstraint({ name: 'careDocumentFilePairing', async: false })
export class CareDocumentFilePairingConstraint implements ValidatorConstraintInterface {
  validate(status: unknown, args: ValidationArguments): boolean {
    // An invalid `status` is @IsIn's complaint to make; don't stack a second one on top of it.
    if (status !== 'on_file' && status !== 'none') return true;
    const fileId = (args.object as { fileId?: unknown }).fileId;
    const present = fileId !== undefined && fileId !== null;
    return status === 'on_file' ? present : !present;
  }

  defaultMessage(args: ValidationArguments): string {
    return args.value === 'on_file'
      ? 'fileId is required when status is on_file'
      : 'fileId must be omitted when status is none';
  }
}

export function MatchesCareDocumentStatus(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: CareDocumentFilePairingConstraint,
    });
  };
}
