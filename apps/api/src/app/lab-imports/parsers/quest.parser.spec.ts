import fs from 'fs';
import path from 'path';
import { QuestLabParser } from './quest.parser';

// The fixture mirrors the REAL pdf-parse extraction shape of a Quest report (verified against an
// actual report): one line per text run, analyte values glued to names ("FERRITIN37 L"),
// "AnalyteValue" column headers, units on their own line or inside the range line.
const fixture = fs.readFileSync(path.join(__dirname, '__fixtures__', 'quest-sample.txt'), 'utf8');

describe('QuestLabParser', () => {
  const parser = new QuestLabParser();

  it('detects Quest reports and rejects arbitrary text', () => {
    expect(parser.detect(fixture)).toBe(true);
    expect(parser.detect('LabCorp Patient Report\nWBC 5.0')).toBe(false);
  });

  describe('parse of the sample fixture', () => {
    const report = parser.parse(fixture);
    const byName = (name: string) => report.analytes.find((a) => a.analyte === name);

    it('extracts the report header fields', () => {
      expect(report.format).toBe('quest');
      expect(report.labName).toBe('Quest Diagnostics');
      expect(report.specimenId).toBe('AB123456C');
      // The patient's name comes from the page footer (unambiguous); the header block's first
      // standalone name is the ordering provider.
      expect(report.patientName).toBe('DOE,JANE');
      expect(report.orderingProvider).toBe('SMITH,ALEX');
      // Server-local interpretation of 07/20/2026 09:10 / 07/21/2026 18:35 — assert the date
      // survives rather than a fixed instant, so the test doesn't depend on the host timezone.
      expect(new Date(report.collectedAt as string).getFullYear()).toBe(2026);
      expect(new Date(report.reportedAt as string).getDate()).toBe(21);
    });

    it('parses a glued name+value with a printed L flag and a following range line', () => {
      expect(byName('FERRITIN')).toEqual({
        analyte: 'FERRITIN',
        valueText: '37',
        value: 37,
        unit: 'ng/mL',
        flag: 'L',
        refLow: 38,
        refHigh: 380,
        refText: null, // refText is for ranges that aren't a simple low–high (data-model.md)
        panel: 'FERRITIN',
      });
    });

    it('keeps digits inside comma-heavy analyte names out of the glued value', () => {
      const d = byName('VITAMIN D,25-OH,TOTAL,IA');
      expect(d?.valueText).toBe('75');
      expect(d?.refLow).toBe(30);
      const t = byName('TESTOSTERONE, TOTAL, MALES (ADULT), IA');
      expect(t?.value).toBe(504);
      expect(t?.refLow).toBe(250);
      expect(t?.refHigh).toBe(827);
      expect(t?.unit).toBe('ng/dL');
      // A decimal glued value splits at the full number, not inside it.
      expect(byName('TESTOSTERONE, FREE')?.valueText).toBe('84.5');
    });

    it('strips the (calc) suffix into a clean unit', () => {
      expect(byName('IRON BINDING CAPACITY')?.unit).toBe('mcg/dL');
      expect(byName('% SATURATION')?.unit).toBe('%');
      expect(byName('% SATURATION')?.refLow).toBe(20);
    });

    it('handles compound units and panel attribution across a page-break footer', () => {
      const wbc = byName('WHITE BLOOD CELL COUNT');
      expect(wbc?.unit).toBe('Thousand/uL');
      // The page footer sits between "AnalyteValue" and this line — panel must survive it.
      expect(wbc?.panel).toBe('CBC (INCLUDES DIFF/PLT)');
      expect(byName('ABSOLUTE NEUTROPHILS')?.unit).toBe('cells/uL');
    });

    it('attaches a lone unit line ("%") to the analyte above it', () => {
      expect(byName('NEUTROPHILS')).toMatchObject({
        valueText: '44.1',
        value: 44.1,
        unit: '%',
        refLow: null,
        refHigh: null,
        refText: null,
      });
      // ...but an all-caps line is a panel name, never a unit: BASOPHILS' "%" is followed by the
      // "CORTISOL, TOTAL" panel header, which must not become BASOPHILS' unit.
      expect(byName('BASOPHILS')?.unit).toBe('%');
      expect(byName('CORTISOL, TOTAL')?.panel).toBe('CORTISOL, TOTAL');
    });

    it('keeps multi-line time-dependent ranges verbatim in refText, never guessing low/high', () => {
      const cortisol = byName('CORTISOL, TOTAL');
      expect(cortisol?.unit).toBe('mcg/dL'); // from its own unit line
      expect(cortisol?.refLow).toBeNull();
      expect(cortisol?.refHigh).toBeNull();
      expect(cortisol?.refText).toBe(
        'For 8 a.m.(7-9 a.m.) Specimen: 4.0-22.0; For 4 p.m.(3-5 p.m.) Specimen: 3.0-17.0',
      );
    });

    it('parses open-ended colonless ranges like "Reference Range    <90"', () => {
      const apob = byName('APOLIPOPROTEIN B');
      expect(apob?.value).toBe(87);
      expect(apob?.unit).toBe('mg/dL');
      expect(apob?.refHigh).toBe(90);
      expect(apob?.refLow).toBeNull();
      expect(apob?.refText).toBe('<90');
    });

    it('never derives a flag from the range (P6): out-of-range without a printed flag stays null', () => {
      expect(report.analytes.filter((a) => a.flag !== null).map((a) => a.analyte)).toEqual(['FERRITIN']);
    });

    it('collects informational lines as verbatim warnings, not analytes', () => {
      expect(report.warnings.some((w) => w.startsWith('Deficiency:'))).toBe(true);
      expect(report.warnings).toContain('See Note 1');
      expect(report.warnings).toContain('* Please interpret above results accordingly *');
      expect(report.warnings.some((w) => w.startsWith('Optimal'))).toBe(true);
      // ...but none of them parsed as analytes.
      expect(byName('Deficiency:')).toBeUndefined();
      expect(byName('Optimal')).toBeUndefined();
    });

    it('silently skips headers, footers, column headers, boilerplate, and the trailer', () => {
      const all = report.warnings.join('\n');
      expect(all).not.toContain('DOE,JANE (AB123456C)');
      expect(all).not.toContain('AnalyteValue');
      expect(all).not.toContain('Performing Sites');
      expect(all).not.toContain('These results have been sent');
      expect(all).not.toContain('registered trademarks');
      expect(all).not.toContain('ANYTOWN'); // demographic block is not a parse failure
    });

    it('parses the full expected analyte set in order', () => {
      expect(report.analytes.map((a) => a.analyte)).toEqual([
        'FERRITIN',
        'VITAMIN D,25-OH,TOTAL,IA',
        'TESTOSTERONE, TOTAL, MALES (ADULT), IA',
        'ALBUMIN',
        'SEX HORMONE BINDING GLOBULIN',
        'TESTOSTERONE, FREE',
        'IRON, TOTAL',
        'IRON BINDING CAPACITY',
        '% SATURATION',
        'WHITE BLOOD CELL COUNT',
        'HEMOGLOBIN',
        'MPV',
        'ABSOLUTE NEUTROPHILS',
        'NEUTROPHILS',
        'BASOPHILS',
        'CORTISOL, TOTAL',
        'APOLIPOPROTEIN B',
      ]);
    });
  });

  it('keeps a non-numeric printed value verbatim with value null', () => {
    const report = parser.parse(
      ['TSH PANEL', 'AnalyteValue', 'TSH<0.2 L', 'Reference Range: 0.4-4.5 mIU/L'].join('\n'),
    );
    expect(report.analytes[0]).toMatchObject({
      analyte: 'TSH',
      valueText: '<0.2',
      value: null,
      flag: 'L',
      refLow: 0.4,
      refHigh: 4.5,
    });
  });

  it('still parses the spaced single-line variant (fallback for other extraction libraries)', () => {
    const report = parser.parse(
      ['FERRITIN', 'Analyte Value', 'FERRITIN 37 L Reference Range: 38-380 ng/mL'].join('\n'),
    );
    expect(report.analytes[0]).toMatchObject({
      analyte: 'FERRITIN',
      valueText: '37',
      flag: 'L',
      refLow: 38,
      refHigh: 380,
      unit: 'ng/mL',
    });
  });
});
