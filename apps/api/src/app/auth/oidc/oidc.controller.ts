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

    const response = await this.auth.loginOrProvisionOidc(claims);
    const handoff = this.oidc.parkForHandoff(response);
    res.redirect(`/oidc-complete?code=${encodeURIComponent(handoff)}`);
  }

  @Post('exchange')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  exchange(@Body() dto: ExchangeOidcCodeDto) {
    const response = this.oidc.redeemHandoff(dto.code);
    if (!response) {
      throw new NotFoundException('OIDC_HANDOFF_NOT_FOUND');
    }
    return response;
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
