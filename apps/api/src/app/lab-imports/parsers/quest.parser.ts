import { ParsedLabAnalyte, ParsedLabReport } from '@salud/shared/types';
import { LabFormatParser } from './lab-format-parser';

// Line-oriented state machine over pdf-parse's text extraction of a Quest Diagnostics report.
//
// pdf-parse emits one line per positioned text run, which for these reports means
// (see parsers/__fixtures__/quest-sample.txt for a synthetic example):
//   - a demographic header block, one field per line ("Specimen: AB123456C",
//     "Collected: 07/20/2026 09:10"), plus standalone name lines (ordering provider first,
//     patient later)
//   - repeated panels: a panel-name line, then an "AnalyteValue" column-header line, then
//     analyte lines with the printed value GLUED to the name — "FERRITIN37 L",
//     "VITAMIN D,25-OH,TOTAL,IA75", "TESTOSTERONE, FREE84.5" — flag separated by a space
//   - the unit either inside the following "Reference Range: 38-380 ng/mL" line, or on its own
//     line ("%", "mcg/dL") when there is no simple range
//   - "Reference Range" lines attach to the analyte above them — sometimes several
//     (time-dependent cortisol), sometimes open-ended ("Reference Range    <90")
//   - interleaved free-text comments/notes, surfaced verbatim as warnings
//   - per-page footers "DOE,JANE (AB123456C)1 / 38/11/26" — skipped, but also the most
//     reliable place the PATIENT's name appears (the header block mixes it with the provider's)
//   - trademark/results-notice boilerplate and a "Performing Sites" trailer
//
// The spaced variants of these shapes ("FERRITIN 37 L Reference Range: 38-380 ng/mL") are kept
// as fallbacks so a change in extraction library doesn't zero the parser.
//
// Principles: record only what the report printed — flags are never derived from ranges (P6),
// and valueText keeps the verbatim value even when it isn't numeric ("<0.2"). Anything in the
// body the machine can't classify lands in `warnings` so the preview can show it, rather than
// being silently dropped.

const WARNINGS_CAP = 50;

// Analyte names on Quest reports are upper-case (with digits, commas, parens, %, hyphens).
// This is the guard that keeps informational lines like "Deficiency: <20 ng/mL" or
// "Moderate        90-129" from parsing as analytes: they carry lower-case letters.
const UPPERCASE_NAME = /^[A-Z0-9%][A-Z0-9 ,.'()%/+-]*$/;

// value token: 37, 4.74, <0.2, >1000
const VALUE = '([<>]?\\d+(?:\\.\\d+)?)';
// "FERRITIN37 L" / "TESTOSTERONE, FREE84.5" / "FERRITIN 37 L" — name (possibly glued), trailing
// value, optional printed flag. Lazy name = the split happens at the EARLIEST spot whose
// remainder is a pure value(+flag) tail, so digits inside names ("VITAMIN D,25-OH") stay in the
// name. Known limit: a name that itself ends in digits ("VITAMIN B12") would donate them to the
// value; the preview exists to catch exactly that kind of misread.
const GLUED_VALUE_LINE = new RegExp(`^(.+?)\\s*${VALUE}\\s*(L|H)?$`);
const INLINE_RANGE_LINE = new RegExp(`^(.+?)\\s+${VALUE}(?:\\s+(L|H))?\\s+Reference Range:?\\s*(.+)$`);
const VALUE_UNIT_LINE = new RegExp(`^(.+?)\\s+${VALUE}(?:\\s+(L|H))?\\s+([%A-Za-z][\\w%./-]*)$`);
const RANGE_CONTINUATION = /^Reference Range:?\s*(.+)$/;
// A line that is nothing but a unit ("%", "mcg/dL", "mg/dL"). Real units are "%" or carry
// lower-case letters — an all-caps line here is a panel name, not a unit.
const UNIT_LINE = /^(%|[A-Za-z][\w%./()-]*)$/;
const COLUMN_HEADER = /^Analyte\s*Value$/;
// "DOE,JANE (AB123456C)1 / 38/11/26" — page footer; also carries the patient name.
const PAGE_FOOTER = /^([A-Z'.-]+,[A-Z .'-]+?)\s*\(([A-Z0-9]+)\)/;
const NAME_LINE = /^[A-Z][A-Z'.-]*,\s*[A-Z][A-Z .'-]*$/;
const TRAILER = /^Performing Sites/i;
// Legal/notice boilerplate that precedes the trailer on the last page — expected, not a parse
// failure worth warning about.
const BOILERPLATE = [
  /^Quest, Quest Diagnostics/,
  /^party marks/,
  /rights reserved\.?\s*$/,
  /^These results have been sent/,
  /healthcare professional\.?\s*$/,
  /^Key$/,
  /^Priority Out of Range/,
];
const SIMPLE_RANGE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(.*)$/;
const OPEN_HIGH = /^<\s*(\d+(?:\.\d+)?)\s*(.*)$/;
const OPEN_LOW = /^>\s*(\d+(?:\.\d+)?)\s*(.*)$/;

function toIso(date: string, time: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const t = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  // Server-local interpretation: the report prints no timezone. Acceptable because the preview
  // shows collectedAt in an editable field — the caregiver confirms the moment before anything
  // is stored (frontend.md → "Lab import").
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    t ? Number(t[1]) : 0,
    t ? Number(t[2]) : 0,
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function stripCalc(unit: string): string | null {
  const cleaned = unit.replace(/\s*\(calc\)\s*$/, '').trim();
  return cleaned || null;
}

export class QuestLabParser implements LabFormatParser {
  readonly format = 'quest' as const;

  detect(text: string): boolean {
    return /quest\s+diagnostics/i.test(text);
  }

  parse(text: string): ParsedLabReport {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const report: ParsedLabReport = {
      format: 'quest',
      labName: 'Quest Diagnostics',
      specimenId: null,
      collectedAt: null,
      reportedAt: null,
      orderingProvider: null,
      patientName: null,
      analytes: [],
      warnings: [],
    };

    const warnings: string[] = [];
    let warningsOverflow = 0;
    const warn = (line: string) => {
      if (warnings.includes(line)) return;
      if (warnings.length >= WARNINGS_CAP) {
        warningsOverflow++;
        return;
      }
      warnings.push(line);
    };

    let inBody = false;
    let currentPanel: string | null = null;
    // The most recent analyte, still accepting range/unit continuation lines until the next
    // analyte/panel closes it. Already pushed to report.analytes — mutation is attachment.
    let current: ParsedLabAnalyte | null = null;
    let previousLine = '';
    // Standalone name lines in the header block: the ordering provider prints before the patient.
    const headerNames: string[] = [];

    const attachRangeTail = (analyte: ParsedLabAnalyte, tail: string) => {
      const trimmed = tail.trim();
      const simple = SIMPLE_RANGE.exec(trimmed);
      if (simple && analyte.refLow === null && analyte.refHigh === null) {
        analyte.refLow = Number(simple[1]);
        analyte.refHigh = Number(simple[2]);
        if (!analyte.unit && simple[3]) analyte.unit = stripCalc(simple[3]);
        return;
      }
      const high = OPEN_HIGH.exec(trimmed);
      const low = high ? null : OPEN_LOW.exec(trimmed);
      if (high && analyte.refHigh === null) {
        analyte.refHigh = Number(high[1]);
        if (!analyte.unit && high[2]) analyte.unit = stripCalc(high[2]);
      } else if (low && analyte.refLow === null) {
        analyte.refLow = Number(low[1]);
        if (!analyte.unit && low[2]) analyte.unit = stripCalc(low[2]);
      }
      // Whatever the tail was — open-ended, time-dependent prose, a second range — keep it
      // verbatim so nothing the lab printed about the range is lost.
      const combined = analyte.refText ? `${analyte.refText}; ${trimmed}` : trimmed;
      analyte.refText = combined.slice(0, 300);
    };

    const pushAnalyte = (
      name: string,
      valueText: string,
      flag: string | undefined,
      unit: string | null,
    ): ParsedLabAnalyte => {
      const analyte: ParsedLabAnalyte = {
        analyte: name.trim(),
        valueText,
        value: /^\d/.test(valueText) ? Number(valueText) : null,
        unit,
        flag: flag === 'L' || flag === 'H' ? flag : null,
        refLow: null,
        refHigh: null,
        refText: null,
        panel: currentPanel,
      };
      report.analytes.push(analyte);
      return analyte;
    };

    for (const line of lines) {
      if (TRAILER.test(line)) break; // performing sites — nothing left to read

      const footer = PAGE_FOOTER.exec(line);
      if (footer) {
        // The header block mixes the patient's and the provider's names; the footer is
        // unambiguously the patient's.
        if (!report.patientName) report.patientName = footer[1];
        previousLine = line;
        continue;
      }

      if (COLUMN_HEADER.test(line)) {
        // The line before "AnalyteValue" is the panel name. It may have just been classified as
        // a warning (an all-caps line with no value matches nothing) — reclaim it.
        if (previousLine && UPPERCASE_NAME.test(previousLine)) {
          currentPanel = previousLine;
          const idx = warnings.lastIndexOf(previousLine);
          if (idx !== -1) warnings.splice(idx, 1);
        }
        inBody = true;
        current = null;
        previousLine = line;
        continue;
      }

      if (!inBody) {
        // Demographic/header block: harvest the fields we can name, skip the rest silently —
        // addresses and phone numbers aren't parse failures worth warning about.
        if (NAME_LINE.test(line)) headerNames.push(line);
        const specimen = /Specimen:\s*([A-Z0-9]+)/.exec(line);
        if (specimen && !report.specimenId) report.specimenId = specimen[1];
        const collected = /Collected:\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(line);
        if (collected && !report.collectedAt) report.collectedAt = toIso(collected[1], collected[2]);
        const reported = /Reported:\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(line);
        if (reported && !report.reportedAt) report.reportedAt = toIso(reported[1], reported[2]);
        // Older single-line header layout: the provider name trails the Received field.
        const provider = /Received:\s*\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?\s+(\D.*)$/.exec(line);
        if (provider && !report.orderingProvider) report.orderingProvider = provider[1].trim();
        previousLine = line;
        continue;
      }

      if (BOILERPLATE.some((re) => re.test(line))) {
        previousLine = line;
        continue;
      }

      const inline = INLINE_RANGE_LINE.exec(line);
      if (inline && UPPERCASE_NAME.test(inline[1].trim())) {
        current = pushAnalyte(inline[1], inline[2], inline[3], null);
        attachRangeTail(current, inline[4]);
        previousLine = line;
        continue;
      }

      const continuation = RANGE_CONTINUATION.exec(line);
      if (continuation) {
        if (current) attachRangeTail(current, continuation[1]);
        else warn(line);
        previousLine = line;
        continue;
      }

      const valueUnit = VALUE_UNIT_LINE.exec(line);
      if (valueUnit && UPPERCASE_NAME.test(valueUnit[1].trim())) {
        current = pushAnalyte(valueUnit[1], valueUnit[2], valueUnit[3], stripCalc(valueUnit[4]));
        previousLine = line;
        continue;
      }

      const glued = GLUED_VALUE_LINE.exec(line);
      if (glued && UPPERCASE_NAME.test(glued[1].trim())) {
        current = pushAnalyte(glued[1], glued[2], glued[3], null);
        previousLine = line;
        continue;
      }

      // A lone unit line ("%", "mcg/dL") belongs to the analyte above it. All-caps lines are
      // panel names, not units — those fall through and get reclaimed at the next AnalyteValue.
      if (current && !current.unit && UNIT_LINE.test(line) && (line === '%' || /[a-z]/.test(line))) {
        current.unit = line;
        previousLine = line;
        continue;
      }

      warn(line);
      previousLine = line;
    }

    if (!report.patientName && headerNames.length) {
      // Fallback: the patient's name is the last standalone name in the header block.
      report.patientName = headerNames[headerNames.length - 1];
    }
    if (!report.orderingProvider) {
      const provider = headerNames.find((n) => n !== report.patientName);
      report.orderingProvider = provider ?? null;
    }

    report.warnings = warningsOverflow
      ? [...warnings, `…and ${warningsOverflow} more unrecognized lines`]
      : warnings;
    return report;
  }
}
