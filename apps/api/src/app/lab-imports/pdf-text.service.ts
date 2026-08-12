import { Injectable } from '@nestjs/common';

// pdf-parse@1.1.1 is CJS with no bundled types; a typed local require behind this one service
// keeps the dependency swappable and lets parser tests run on plain fixture text (same
// @types-avoidance pattern as files.controller.ts's UploadedMulterFile).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require('pdf-parse');

@Injectable()
export class PdfTextService {
  /** Extracts the text layer of a PDF. Throws on anything that isn't a readable PDF. */
  async extract(buffer: Buffer): Promise<string> {
    const result = await pdfParse(buffer);
    return result.text;
  }
}
