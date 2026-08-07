import { ApiErrorCode, ERROR_SENTENCES, apiErrorCode, errorText } from './error-display';

const httpError = (message: unknown) => ({ error: { message } });

describe('apiErrorCode', () => {
  it('reads a code from the string form', () => {
    expect(apiErrorCode(httpError('PATIENT_NOT_FOUND'))).toBe('PATIENT_NOT_FOUND');
  });

  it('reads a path-prefixed code out of the array form, ignoring the prose sibling', () => {
    expect(
      apiErrorCode(httpError(['entries.0.OBSERVATION_SCHEMA_INVALID', 'observedAt must be a valid ISO 8601 date string'])),
    ).toBe('OBSERVATION_SCHEMA_INVALID');
  });

  it('returns null for an array of pure class-validator prose', () => {
    expect(apiErrorCode(httpError(['observedAt must be a valid ISO 8601 date string']))).toBeNull();
  });

  it('returns null for framework prose with no code', () => {
    expect(apiErrorCode(httpError('Unauthorized'))).toBeNull();
    expect(apiErrorCode(httpError('Validation failed (uuid v4 is expected)'))).toBeNull();
    expect(apiErrorCode(httpError('File too large'))).toBeNull();
  });

  it('returns null for an unmapped future code rather than guessing', () => {
    expect(apiErrorCode(httpError('SOME_FUTURE_CODE'))).toBeNull();
  });

  it('never throws on junk input', () => {
    expect(apiErrorCode(null)).toBeNull();
    expect(apiErrorCode(undefined)).toBeNull();
    expect(apiErrorCode(new Error('boom'))).toBeNull();
    expect(apiErrorCode({ error: new Blob([]) })).toBeNull();
    expect(apiErrorCode({ error: { message: 42 } })).toBeNull();
    expect(apiErrorCode({ error: { message: [1, 2] } })).toBeNull();
    expect(apiErrorCode('a plain string')).toBeNull();
  });
});

describe('errorText', () => {
  it('returns the sentence for a recognized code', () => {
    expect(errorText(httpError('EMAIL_TAKEN'), 'fallback')).toBe(ERROR_SENTENCES.EMAIL_TAKEN);
  });

  it('falls back for prose, an unmapped code, or a bodyless error', () => {
    expect(errorText(httpError('Unauthorized'), 'Could not sign in.')).toBe('Could not sign in.');
    expect(errorText(httpError('SOME_FUTURE_CODE'), 'Could not save.')).toBe('Could not save.');
    expect(errorText(new Error('network down'), 'Could not save.')).toBe('Could not save.');
  });

  it('prefers an override for the code that actually occurred', () => {
    expect(
      errorText(httpError('USER_NOT_FOUND'), 'fallback', {
        USER_NOT_FOUND: 'That caregiver is no longer on this care team.',
      }),
    ).toBe('That caregiver is no longer on this care team.');
  });

  it('ignores an override for a code that did not occur', () => {
    expect(
      errorText(httpError('PATIENT_NOT_FOUND'), 'fallback', {
        USER_NOT_FOUND: 'unrelated override',
      }),
    ).toBe(ERROR_SENTENCES.PATIENT_NOT_FOUND);
  });
});

describe('ERROR_SENTENCES catalog invariants', () => {
  const entries = Object.entries(ERROR_SENTENCES) as Array<[ApiErrorCode, string]>;

  it.each(entries)('%s is a non-empty, calm sentence', (_code, sentence) => {
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence.trim()).toBe(sentence);
    expect(sentence.endsWith('.')).toBe(true);
    expect(sentence).not.toContain('!');
    // A sentence must never itself contain a raw code — that would just move the leak.
    expect(sentence).not.toMatch(/\b[A-Z][A-Z_]{2,}\b/);
  });

  it('never implies a permission problem for PATIENT_NOT_FOUND, which would leak the 404 it is hiding', () => {
    // api.md → "Resource shape and access control": non-membership is 404, never 403, specifically so
    // the response doesn't confirm the patient exists. Wording here must not undo that.
    expect(ERROR_SENTENCES.PATIENT_NOT_FOUND).not.toMatch(/permission|access|care team|not allowed/i);
  });
});
