import { LabFormat, ParsedLabReport } from '@salud/shared/types';

/**
 * One implementation per supported lab-report format (app-spec/api.md → "Lab imports").
 * Everything downstream of ParsedLabReport is format-agnostic: adding a format is a new
 * implementation plus a registry entry, not an API change.
 */
export interface LabFormatParser {
  readonly format: LabFormat;
  /** Cheap sniff over the extracted text — used when the client doesn't force a format. */
  detect(text: string): boolean;
  parse(text: string): ParsedLabReport;
}
