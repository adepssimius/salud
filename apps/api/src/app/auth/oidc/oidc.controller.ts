import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { isProduction } from '../../config/env';
import { resolveRequestOrigin } from '../../er-brief/request-origin';
import { AuthService } from '../auth.service';
import { OidcService } from './oidc.service';
import { ExchangeOidcCodeDto } from './dto/exchange-code.dto';

const TXN_COOKIE = 'salud_oidc_txn';
const TXN_COOKIE_PATH = '/api/auth/oidc';
const TXN_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

interface OidcTransaction {
  state: string;
  nonce: string;
  verifier: string;
}

/**
 * One code per reason, rather than the single OIDC_HANDOFF_NOT_FOUND this used to throw for all
 * three. They are genuinely different situations for the reader — a code that ran out of time is
 * retried, a code that was already spent usually means the session already landed in another tab
 * or an earlier navigation — and collapsing them cost a production diagnosis: the web app's
 * fallback sentence for *any* failed exchange was word-for-word the sentence for this code, so a
 * 404, a 502 and a validation error were indistinguishable on screen.
 */
const HANDOFF_ERROR_CODES = {
  expired: 'OIDC_HANDOFF_EXPIRED',
  already_used: 'OIDC_HANDOFF_ALREADY_USED',
  unknown: 'OIDC_HANDOFF_NOT_FOUND',
} as const;

/**
 * The Authelia OIDC login flow (security.md → "OIDC login"). `login`/`callback` are real browser
 * navigations, not JSON endpoints — a Salud login has to leave this origin and come back, so
 * there is no XHR-shaped version of either. `exchange` is the one JSON endpoint, called by the
 * SPA's `/oidc-complete` page. All three are unguarded, the same public-controller pattern as
 * `/auth/login` and `/auth/register`.
 */
@Controller('auth/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly auth: AuthService,
  ) {}

  @Get('login')
  async login(@Req() req: Request, @Res() res: Response) {
    const redirectUri = `${resolveRequestOrigin(req)}/api/auth/oidc/callback`;
    const { url, state, nonce, verifier } = await this.oidc.buildAuthorizationRequest(redirectUri);

    const transaction: OidcTransaction = { state, nonce, verifier };
    res.cookie(TXN_COOKIE, JSON.stringify(transaction), {
      httpOnly: true,
      secure: isProduction(),
      // Lax, not Strict: the callback is a cross-site top-level GET navigation Authelia initiates
      // — Strict would drop the cookie before it ever reaches the callback handler. Matches
      // k8s-infra's own Authelia session cookie (session.same_site: "lax") for the same reason.
      sameSite: 'lax',
      path: TXN_COOKIE_PATH,
      maxAge: TXN_COOKIE_MAX_AGE_MS,
      signed: true,
    });

    res.redirect(url);
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    res.clearCookie(TXN_COOKIE, { path: TXN_COOKIE_PATH });

    // cookie-parser sets this to `false` (not undefined) when a signed cookie's signature fails
    // to verify, so a falsy check covers both "never set" and "tampered with".
    const raw = req.signedCookies?.[TXN_COOKIE];
    const transaction = this.parseTransaction(raw);
    if (!transaction) {
      res.redirect('/login?error=oidc_state');
      return;
    }

    const callbackUrl = new URL(`${resolveRequestOrigin(req)}${req.originalUrl}`);

    let claims;
    try {
      claims = await this.oidc.exchangeCode({
        callbackUrl,
        state: transaction.state,
        nonce: transaction.nonce,
        verifier: transaction.verifier,
      });
    } catch (err) {
      this.logger.warn(`OIDC code exchange failed: ${(err as Error).message}`);
      res.redirect('/login?error=oidc_state');
      return;
    }

    if (!this.oidc.hasRequiredGroup(claims)) {
      // Comparable sensitivity to the resource UUIDs deployment.md already permits in access-log
      // lines, and exactly the kind of access-denial signal worth `grep WARN`-ing for.
      this.logger.warn(`OIDC login denied: missing required group email=${claims.email}`);
      res.redirect('/login?error=oidc_forbidden');
      return;
    }

    const user = await this.auth.resolveOidcUser(claims);
    const handoff = await this.oidc.parkForHandoff(user.id);
    res.redirect(`/oidc-complete?code=${encodeURIComponent(handoff)}`);
  }

  @Post('exchange')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async exchange(@Body() dto: ExchangeOidcCodeDto) {
    const result = await this.oidc.redeemHandoff(dto.code);
    if (!result.ok) {
      // Logged, because until now a refused exchange was invisible from the server side: the
      // caregiver got a sentence and `kubectl logs` showed only `POST .../exchange 404` with no
      // reason. Never log the code itself — it is a bearer credential while it lives.
      this.logger.warn(`OIDC handoff refused: ${result.reason}`);
      throw new NotFoundException(HANDOFF_ERROR_CODES[result.reason]);
    }
    return this.auth.issueSessionForUserId(result.userId);
  }

  private parseTransaction(raw: unknown): OidcTransaction | null {
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.state === 'string' &&
        typeof parsed?.nonce === 'string' &&
        typeof parsed?.verifier === 'string'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
}
