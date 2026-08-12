import { LabFormatParser } from './lab-format-parser';
import { QuestLabParser } from './quest.parser';

// Order matters only if two parsers ever detect() the same text; keep more specific ones first.
export const LAB_PARSERS: LabFormatParser[] = [new QuestLabParser()];
