import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Records the error behind every failed response, then hands off to Nest's own filter unchanged.
 *
 * WHY THIS EXISTS. `BaseExceptionFilter.catch` returns early for anything that is an
 * `HttpException`, and only ever calls `logger.error` inside `handleUnknownError` — the branch for
 * exceptions that are *not* HttpExceptions. Because this codebase signals every domain failure by
 * throwing one (`NotFoundException('PATIENT_NOT_FOUND')` and friends — CLAUDE.md → Conventions),
 * the practical effect was that a 404, a 400 and a 401 each produced **zero** log output. The
 * frontend rendered a sentence at the caregiver and the server kept no record that the request had
 * even arrived, which is precisely the "errors in the FE that aren't in the BE" gap.
 *
 * It deliberately does NOT change any response. Every code path ends in `super.catch()`, so status
 * codes and bodies stay byte-for-byte what they were — `apps/web/src/app/core/error-display.ts`
 * parses those bodies, and `app-spec/api.md` → "Error codes" is the contract.
 *
 * Two things are logged here and two are left to the access log, to keep it at one line per
 * request:
 *  - Here: the stack of a 5xx `HttpException` (Nest logs unknown-error stacks itself, but not
 *    these), because a stack does not belong on a single-line access record.
 *  - Stashed on the request for the access log to print: the machine-readable code.
 */
// Module-level rather than a static member: `BaseExceptionFilter` already declares a static
// `logger`, and redeclaring it in a subclass is a type error on the class's static side.
const logger = new Logger('ExceptionsFilter');

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    // Only HTTP requests carry a request object to annotate; a non-http context (none today, but
    // the filter is global) must still reach super.catch() rather than throw on host.switchToHttp.
    if (host.getType() === 'http') {
      const req = host.switchToHttp().getRequest();
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      const code = errorCodeOf(exception);
      if (req && code) {
        // Read back by the access-log middleware in app.observability.ts once the response
        // finishes. A property rather than a header: it must never reach the client.
        req.saludErrorCode = code;
      }
      // Nest logs the stack for non-HttpExceptions inside handleUnknownError. A deliberately
      // thrown 5xx (e.g. ServiceUnavailableException from the readiness probe) gets no such
      // treatment, so log it here — and only here, to avoid doubling up on the unknown-error path.
      if (exception instanceof HttpException && status >= 500) {
        logger.error(
          `${req?.method ?? '?'} ${status} ${code ?? ''}`.trim(),
          exception.stack,
        );
      }
    }
    super.catch(exception, host);
  }
}

/**
 * The machine-readable code from a thrown exception, mirroring how the web app reads it
 * (`error-display.ts` → `rawMessages`): the message is either the code as a string, or an array of
 * them from class-validator. Anything else — framework prose like "Unauthorized", a plain Error —
 * has no code, and the status alone has to carry the meaning.
 */
function errorCodeOf(exception: unknown): string | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const res = exception.getResponse() as any;
  const message = typeof res === 'string' ? res : res?.message;
  if (typeof message === 'string') return looksLikeCode(message) ? message : undefined;
  if (Array.isArray(message)) {
    // A validation failure reports every violated field; the first code is enough to identify the
    // shape of the failure without turning one line into twenty.
    const first = message.find((m) => typeof m === 'string' && looksLikeCode(m));
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

/**
 * Codes are SCREAMING_SNAKE_CASE, optionally path-prefixed by class-validator on a nested object
 * ("entries.0.OBSERVATION_SCHEMA_INVALID"). Matching the shape rather than a hardcoded list means
 * a code added tomorrow logs correctly with no change here — the same reason `error-display.ts`
 * matches on shape. Prose ("Unauthorized", "File too large") deliberately does not match.
 */
function looksLikeCode(raw: string): boolean {
  const tail = raw.slice(raw.lastIndexOf('.') + 1);
  return /^[A-Z][A-Z0-9_]*$/.test(tail) && tail.includes('_');
}
