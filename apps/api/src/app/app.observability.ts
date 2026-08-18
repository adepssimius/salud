import { Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/observability/all-exceptions.filter';
import {
  formatAccessLine,
  isSuppressedProbe,
  levelFor,
} from './common/observability/request-log';

/**
 * HTTP access logging and the global exception filter.
 *
 * Lives in a function taking the app, for the same reason `applyAppSecurity` does: the e2e suites
 * build their app through `Test.createTestingModule` and never execute `main.ts` (ISSUES #26), so
 * anything wired inline there is both untestable and silently different from what deploys.
 *
 * Before this, the API logged only unhandled 500s: every deliberate 4xx was invisible, and a
 * request the client abandoned left no trace whatsoever. One line per completed request, at a
 * level chosen by status and duration, is what makes a latency or error report answerable from
 * `kubectl logs` instead of from guesswork.
 */
export function applyAppObservability(app: NestExpressApplication) {
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));

  if (!accessLogEnabled()) return;

  const logger = new Logger('HTTP');
  const slowMs = slowRequestMs();

  // Express middleware rather than a Nest interceptor, and this is load-bearing. An interceptor
  // never runs for a request that fails before reaching a handler — an unmatched route, a guard
  // rejection, a body that fails the global ValidationPipe — which is a large share of exactly the
  // errors this is meant to surface. Middleware sees every request the process accepts.
  app.use((req: any, res: any, next: any) => {
    const startedAt = process.hrtime.bigint();

    let logged = false;
    const emit = () => {
      // Both events fire on a normal response ('finish' then 'close'), so the guard keeps it to
      // one line per request.
      if (logged) return;
      logged = true;

      // The response stream ended without ever completing: the connection died first. This is a
      // narrower signal than it looks, and the limit is worth knowing when reading the logs. Once
      // the kernel has buffered the whole response, Node reports the write as fully successful
      // even if the client is already gone — a caregiver's phone dropping the connection, or a
      // proxy that has stopped waiting, both still log as a normal 200. What this DOES catch is a
      // connection destroyed before the response was written out, which is the shape a long
      // request takes when the peer resets it mid-flight.
      const aborted = !res.writableFinished;

      const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const statusCode = res.statusCode;
      if (isSuppressedProbe(req.originalUrl ?? req.url ?? '', statusCode)) return;

      const line = formatAccessLine(
        {
          method: req.method,
          originalUrl: req.originalUrl ?? req.url ?? '',
          statusCode,
          durationMs,
          // Set by JwtStrategy.validate on an authenticated request; absent on login, register
          // and the public brief route.
          userId: req.user?.userId,
          // Stashed by AllExceptionsFilter when the response came from a thrown exception.
          errorCode: req.saludErrorCode,
          aborted,
        },
        slowMs,
      );

      // An abandoned request is a warning at minimum: a status nobody received is not a success.
      const level = aborted ? 'warn' : levelFor(statusCode, durationMs, slowMs);
      logger[level](line);
    };

    res.on('finish', emit);
    res.on('close', emit);
    next();
  });
}

/**
 * Off with `ACCESS_LOG=false`. There is no sampling: this is a single-household deployment whose
 * request volume is a few hundred a day, so the honest default is to log all of them.
 */
function accessLogEnabled(): boolean {
  return process.env.ACCESS_LOG !== 'false';
}

/** A request at or over this is logged at warn and tagged SLOW. Override with `SLOW_REQUEST_MS`. */
function slowRequestMs(): number {
  const raw = Number(process.env.SLOW_REQUEST_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}
