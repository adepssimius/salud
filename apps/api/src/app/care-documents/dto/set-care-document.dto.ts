import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CareDocumentStatus, SetCareDocumentDto as SetCareDocumentDtoShape } from '@salud/shared/types';
import { MatchesCareDocumentStatus } from '../../common/validators';

export class SetCareDocumentDto implements SetCareDocumentDtoShape {
  // The pairing rule lives here rather than on fileId — see MatchesCareDocumentStatus for why.
  @MatchesCareDocumentStatus()
  @IsIn(['on_file', 'none'])
  status!: CareDocumentStatus;

  // Required with status='on_file', forbidden with 'none' (enforced above). The file must also
  // exist and belong to this patient, which the service checks (400
  // CARE_DOCUMENT_FILE_NOT_FOUND) because it needs a database read.
  @IsOptional()
  @IsUUID('4')
  fileId?: string;

  // Accepted only on kind='medical_poa'; the service rejects them on the other two kinds rather
  // than silently dropping them, so a caller never believes it stored a holder it didn't.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  holderName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  holderPhone?: string;
}
