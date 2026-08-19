import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { CARE_DOCUMENT_KINDS, CareDocumentKind } from '@salud/shared/types';

/**
 * Validates the `:kind` path segment against the three care-document kinds.
 *
 * A path parameter never reaches the body `ValidationPipe`, so without this an unknown kind would
 * be written straight into the row's enum column — a statement nothing can ever read back through
 * the three-key map.
 */
@Injectable()
export class ParseCareDocumentKindPipe implements PipeTransform<string, CareDocumentKind> {
  transform(value: string): CareDocumentKind {
    if ((CARE_DOCUMENT_KINDS as string[]).includes(value)) {
      return value as CareDocumentKind;
    }
    throw new BadRequestException(`kind must be one of: ${CARE_DOCUMENT_KINDS.join(', ')}`);
  }
}
