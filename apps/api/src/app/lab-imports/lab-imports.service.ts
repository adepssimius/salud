import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  LabAnalyteResolution,
  LabImportResult,
  ParsedLabAnalyte,
  ParsedLabReport,
} from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import { StorageService } from '../storage/storage.service';
import { FilesService } from '../files/files.service';
import { AnalytesService, titleCaseAnalyte } from '../analytes/analytes.service';
import { careTeamMemberships } from '../../db/schema';
import { PdfTextService } from './pdf-text.service';
import { LAB_PARSERS } from './parsers/parser-registry';
import { CreateLabImportDto } from './dto/create-lab-import.dto';

// A text layer shorter than this is an image-only scan, not a parseable report. Real Quest
// reports extract thousands of characters; 40 keeps genuinely empty extractions out without
// false-failing an unusually terse (but real) text layer.
const MIN_TEXT_CHARS = 40;

@Injectable()
export class LabImportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly filesService: FilesService,
    private readonly pdfText: PdfTextService,
    private readonly analytesService: AnalytesService,
  ) {}

  private async ensurePatientAccess(patientId: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (!rows.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }
  }

  /**
   * Stateless parse (api.md → "Lab imports"): reads the already-uploaded PDF, extracts its text,
   * picks a format parser, and returns the normalized result. Persists nothing — the confirm step
   * is a normal observation create — and the PDF stays in storage on every failure path, so a
   * failed import can be inspected and retried without re-uploading.
   */
  async parse(patientId: string, userId: string, dto: CreateLabImportDto): Promise<LabImportResult> {
    await this.ensurePatientAccess(patientId, userId);

    const file = await this.filesService.getUsableForPatient(dto.fileId, patientId, userId, 'LAB_FILE_NOT_FOUND');
    if (file.contentType !== 'application/pdf') {
      throw new BadRequestException('LAB_PDF_UNPARSEABLE');
    }

    const buffer = await this.storage.read(file.path);
    let text: string;
    try {
      text = await this.pdfText.extract(buffer);
    } catch {
      // One code for "not really a PDF" and "unreadable PDF" — the user's remedy is identical:
      // upload the original PDF from the lab, not a photo, scan, or renamed file.
      throw new BadRequestException('LAB_PDF_UNPARSEABLE');
    }
    if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
      throw new BadRequestException('LAB_PDF_UNPARSEABLE');
    }

    const parser = dto.format
      ? LAB_PARSERS.find((p) => p.format === dto.format)
      : LAB_PARSERS.find((p) => p.detect(text));
    if (!parser) {
      throw new BadRequestException('LAB_FORMAT_UNSUPPORTED');
    }

    const parsed = parser.parse(text);
    const resolutions = await this.resolveAgainstCatalog(patientId, parsed);
    return { fileId: dto.fileId, parsed, resolutions };
  }

  /**
   * Line up each parsed analyte with the catalog, without writing anything (api.md → Lab imports).
   *
   * The comparison is against the range in effect **at the specimen's collection time**, not now:
   * importing an old report must be read against the standard that applied when it was drawn.
   * Where the report and the catalog disagree, the status is `conflict` and the decision is the
   * caregiver's — the app never silently adopts one over the other (P6).
   */
  private async resolveAgainstCatalog(patientId: string, parsed: ParsedLabReport): Promise<LabAnalyteResolution[]> {
    if (!parsed.analytes.length) return [];

    const atTs = Math.floor(
      new Date(parsed.collectedAt ?? parsed.reportedAt ?? new Date().toISOString()).getTime() / 1000,
    );
    const catalog = await this.analytesService.list();
    const byName = new Map(catalog.map((a) => [a.name.trim().toLowerCase(), a]));
    const known = parsed.analytes
      .map((a) => byName.get(a.analyte.trim().toLowerCase()))
      .filter((a): a is NonNullable<typeof a> => !!a);
    const sources = await this.analytesService.labContextSources(patientId, known.map((a) => a.id));

    return parsed.analytes.map((analyte) => {
      const match = byName.get(analyte.analyte.trim().toLowerCase());
      if (!match) {
        return {
          analyte: analyte.analyte,
          analyteId: null,
          displayName: titleCaseAnalyte(analyte.analyte),
          status: 'new' as const,
          catalogRange: null,
          ranges: [],
        };
      }
      const source = sources.get(match.id);
      // Only the patient's own 'reference' lineage is what an incoming report is talking about;
      // their targets and interpretation bands ride along for display and are never touched.
      const effectiveByLineage = source ? AnalytesService.resolveLineagesAt(source.ranges, atTs) : [];
      const effective = effectiveByLineage.find((r) => r.kind === 'reference') ?? null;
      return {
        analyte: analyte.analyte,
        analyteId: match.id,
        displayName: match.displayName,
        status: this.rangeStatus(analyte, effective),
        catalogRange: effective ? AnalytesService.rangeContext(effective) : null,
        ranges: effectiveByLineage
          .filter((r) => r.kind !== 'reference')
          .map((r) => AnalytesService.rangeContext(r)),
      };
    });
  }

  private rangeStatus(
    analyte: ParsedLabAnalyte,
    effective: { low: number | null; high: number | null; refText: string | null } | null,
  ): LabAnalyteResolution['status'] {
    const printsRange = analyte.refLow !== null || analyte.refHigh !== null || !!analyte.refText;
    if (!printsRange) return 'no_printed_range';
    if (!effective) return 'new_range';
    const sameText = (effective.refText ?? '').trim() === (analyte.refText ?? '').trim();
    const same = effective.low === analyte.refLow && effective.high === analyte.refHigh && sameText;
    return same ? 'match' : 'conflict';
  }
}
