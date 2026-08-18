// Human-readable formatting for failed API requests.
//
// The API returns machine-readable error codes as the message string (app-spec/api.md → "Validation
// & errors") — but never assume the body actually contains one. Three shapes reach here:
//  - An explicit throw: `message` is a STRING holding the code, e.g. "PATIENT_NOT_FOUND".
//  - A class-validator failure: `message` is an ARRAY, and a nested-object code arrives
//    path-prefixed with the property name dropped — "entries.0.OBSERVATION_SCHEMA_INVALID" rather
//    than "entries.0.metadata: OBSERVATION_SCHEMA_INVALID".
//  - Plain framework prose with no code at all (an auth guard's "Unauthorized", ParseUUIDPipe's
//    "Validation failed (uuid v4 is expected)", multer's "File too large").
//
// The rule: a recognized code gets its sentence; EVERYTHING ELSE — prose, an unmapped future code,
// a body that doesn't even look like an HTTP error — falls back to the caller's own fallback text.
// Prose is never shown verbatim; that's how a raw "INVALID_CREDENTIALS" ended up on the login screen
// before this module existed. An unmapped code degrading safely (instead of leaking) is what makes
// this safe to leave unattended as new codes are added on the API side.

export const ERROR_SENTENCES = {
  ADVISORY_NOT_FOUND: 'That alert is no longer showing. Refresh the page to see the current ones.',
  ANALYTE_IN_USE:
    "This analyte still has recorded lab results pointing at it, so it can't be deleted. Remove or re-map those results first.",
  ANALYTE_NAME_TAKEN:
    'An analyte with that name is already in the catalog. Open that one instead, or choose a different name.',
  ANALYTE_NOT_FOUND: 'That analyte is no longer in the catalog. Search for it again.',
  ANALYTE_RANGE_EMPTY: 'A range needs a low bound, a high bound, or range text.',
  ANALYTE_RANGE_NOT_FOUND: 'That range no longer exists. Reload this analyte.',
  AT_LEAST_ONE_ENTRY_REQUIRED: 'Add at least one entry before saving.',
  BODY_LOCATION_REQUIRED: 'A dressing change needs a body location. Add one and try again.',
  CANNOT_REMOVE_OWNER: 'The owner cannot be removed from the care team. Make someone else the owner first.',
  CONDITION_NOT_FOUND: 'That condition is no longer available. It may have been deleted.',
  // Same non-disclosure stance as PHOTO_FILE_NOT_FOUND: silent on which failure mode it was.
  DOCUMENT_FILE_NOT_FOUND: 'That document could not be attached. Upload it again and retry.',
  EMAIL_TAKEN: 'An account with that email already exists. Try signing in instead.',
  EMBODIMENT_NOT_FOUND: 'That form of the medication is no longer available. Choose another one.',
  DATE_IN_FUTURE: 'That date and time is in the future. Check it and try again.',
  EMBODIMENT_IN_USE:
    'This form is still used by a schedule, a dose already logged, or a reaction. Remove those first, or mark the medication inactive instead.',
  EPISODE_ALREADY_RESOLVED: 'That episode has already been resolved. Refresh to see the current status.',
  EPISODE_NOT_FOUND: 'That episode is no longer available. Refresh the page and try again.',
  GUIDELINE_AGE_RANGE_INVALID:
    'The minimum age must be lower than the maximum age. Check both and try again.',
  GUIDELINE_IN_USE: 'This guideline is attached to doses already logged. It cannot be deleted.',
  FILE_NOT_FOUND: 'That photo is no longer available.',
  FILE_REQUIRED: 'Choose a photo to upload.',
  FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED: 'Set how often this repeats, or list the specific times of day.',
  GUIDELINE_NOT_FOUND: 'No dosing guidance is available for this medication yet.',
  INTERVENTION_NOT_FOUND: 'That dose or treatment is no longer available. It may have been deleted.',
  INVALID_CREDENTIALS: 'That email and password do not match an account. Check both and try again.',
  INVALID_REACTION_SCOPE: 'Choose exactly one of medication, form, or tag for this reaction.',
  LAB_FILE_NOT_FOUND: 'That uploaded report could not be found. Upload it again and retry.',
  LAB_FORMAT_UNSUPPORTED:
    "This lab report format isn't supported yet. Only Quest Diagnostics reports can be imported right now.",
  LAB_PDF_UNPARSEABLE:
    'That file could not be read as a lab report. Upload the original document from the lab, not a photo or scan.',
  MEDICATION_ID_REQUIRED: 'Choose a medication for this dose.',
  MEDICATION_IN_USE:
    'This medication is still in use. Remove its forms, guidelines and schedules first, or mark it inactive instead.',
  MEDICATION_NAME_TAKEN:
    'A medication with that name is already in your list. Open that one instead, or choose a different name.',
  MEDICATION_NOT_FOUND: 'That medication is no longer available. Search for it again.',
  OBSERVATION_NOT_FOUND: 'That observation is no longer available. It may have been deleted.',
  OBSERVATION_SCHEMA_INVALID:
    'One of the entries is missing something or has a value out of range. Check each entry, then save again.',
  // Unlike PATIENT_NOT_FOUND below, this one *may* name the permission: the API only answers 403
  // to someone already known to be on the care team, so there is nothing left to hide.
  NOT_PATIENT_OWNER:
    "Only this patient's owner can delete them. Ask the owner, or have them transfer ownership to you first.",
  // The oidc-complete page's own fallback text already covers this well (security.md → "OIDC
  // login"); this entry exists so a direct API caller or a future call site gets the same
  // sentence instead of degrading to something generic.
  OIDC_HANDOFF_NOT_FOUND: 'This sign-in link has expired or was already used. Try signing in again.',
  PASSWORD_AUTH_DISABLED: 'Password sign-in is turned off. Use "Sign in with Authelia" instead.',
  PATIENT_ID_REQUIRED: 'Choose a patient first.',
  // Deliberately silent on which of "no such file" / "someone else's file" it was, for the same
  // non-disclosure reason FILE_NOT_FOUND is.
  PHOTO_FILE_NOT_FOUND: 'That photo could not be attached. Upload it again and retry.',
  // Deliberately silent on *why* — the API answers 404 rather than 403 specifically so this response
  // doesn't confirm the patient exists at all (app-spec/api.md → "Resource shape and access
  // control"). Do not mention permission, access, or the care team here: that would leak exactly
  // what the 404 is hiding. The sentence must read the same whether the patient was deleted, was
  // never this caregiver's, or the id was mistyped.
  PATIENT_NOT_FOUND: 'This patient is not available. Go back to your patients list and choose from there.',
  PROTOCOL_NOT_FOUND: 'That protocol is no longer available.',
  RESOLVES_MUST_BE_SUBSET_OF_EPISODES:
    'You can only resolve an episode this entry belongs to. Add the episode first, then mark it resolved.',
  SCHEDULE_EPISODE_CONDITION_CONFLICT:
    'A schedule can be linked to an episode or a condition, not both. Clear one of them.',
  SCHEDULE_NOT_FOUND: 'That schedule is no longer available. It may have been deleted.',
  SELF_RELATIONSHIP_ALREADY_EXISTS:
    'Someone on this care team is already marked as the patient. Change their relationship first.',
  SNAPSHOT_NOT_FOUND: 'That shared link is no longer available. It may have expired or been revoked.',
  // Covers two of the three contexts this code is thrown in: adding a caregiver by a stale search
  // result, and transferring patient ownership to an unknown user (api.md's error table). The third
  // — a 401 on /users/me when the signed-in account no longer exists — is handled by the auth
  // interceptor logging the session out before any page would render this sentence.
  USER_NOT_FOUND: 'No account matches that person. Ask them to sign up first, then add them.',
} as const;

export type ApiErrorCode = keyof typeof ERROR_SENTENCES;
export type ErrorOverrides = Partial<Record<ApiErrorCode, string>>;

function rawMessages(err: unknown): string[] {
  const body = (err as any)?.error;
  if (!body || typeof body !== 'object') return [];
  const message = body.message;
  if (typeof message === 'string') return [message];
  if (Array.isArray(message)) return message.filter((m): m is string => typeof m === 'string');
  return [];
}

function codeFrom(raw: string): ApiErrorCode | null {
  if (raw in ERROR_SENTENCES) return raw as ApiErrorCode;
  // Nested-validator codes arrive path-prefixed, e.g. "entries.0.OBSERVATION_SCHEMA_INVALID". Safe
  // to strip blindly: this only ever matches when the suffix is ALREADY a catalog key, and every key
  // is [A-Z_]+ with no dots, so ordinary prose can never accidentally hit it.
  const tail = raw.slice(raw.lastIndexOf('.') + 1);
  return tail in ERROR_SENTENCES ? (tail as ApiErrorCode) : null;
}

/** The API error code inside a failed response, or null when there isn't one (prose, or no body at all). */
export function apiErrorCode(err: unknown): ApiErrorCode | null {
  for (const raw of rawMessages(err)) {
    const code = codeFrom(raw);
    if (code) return code;
  }
  return null;
}

/**
 * A sentence for a failed request: an override for the code that occurred, else the code's default
 * sentence, else the caller's own fallback. Call at the point a request error is caught, e.g.
 * `error: (err) => this.error.set(errorText(err, 'Could not save observation.'))`.
 */
export function errorText(err: unknown, fallback: string, overrides?: ErrorOverrides): string {
  const code = apiErrorCode(err);
  if (!code) return fallback;
  return overrides?.[code] ?? ERROR_SENTENCES[code];
}
