import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import {
  AuthConfigResponse,
  AuthResponse,
  ExchangeOidcCodeDto,
  LoginDto,
  RegisterDto,
  UpdateUserDto,
  UserProfile,
} from '@salud/shared/types';
import { ApiClientService } from './api-client.service';

const TOKEN_KEY = 'salud_jwt';

/** The JWT's `exp` (epoch seconds), or null when the token doesn't decode or carries none. */
function readExp(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly userSignal = signal<UserProfile | null>(null);

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /**
   * Whether there is a session worth routing on: a stored token whose `exp` claim (if it carries
   * one) has not passed. Synchronous on purpose — the route guards run before any request could
   * answer, and waiting on `/users/me` would show a blank page on every signed-in load. An expired
   * token is dropped here, so a stale session goes to `/login` once instead of reaching a guarded
   * page, firing a 401 and bouncing back. A token the server rejects for any other reason (bad
   * signature, deleted user) still ends through the interceptor's 401 → logout().
   */
  hasSession(nowMs: number = Date.now()): boolean {
    const token = this.token;
    if (!token) return false;
    const exp = readExp(token);
    if (exp !== null && exp * 1000 <= nowMs) {
      localStorage.removeItem(TOKEN_KEY);
      this.userSignal.set(null);
      return false;
    }
    return true;
  }

  get user() {
    return this.userSignal.asReadonly();
  }

  login(dto: LoginDto): Observable<AuthResponse> {
    return this.api.post<AuthResponse, LoginDto>('/auth/login', dto).pipe(
      tap((res) => {
        this.persistSession(res);
      }),
    );
  }

  register(dto: RegisterDto): Observable<AuthResponse> {
    return this.api.post<AuthResponse, RegisterDto>('/auth/register', dto).pipe(
      tap((res) => {
        this.persistSession(res);
      }),
    );
  }

  authConfig(): Observable<AuthConfigResponse> {
    return this.api.get<AuthConfigResponse>('/auth/config');
  }

  // Exchanges the one-time handoff code from GET /auth/oidc/callback's redirect for the real
  // session — see security.md → "OIDC login" for why the JWT never travels in that redirect
  // itself. Same persistSession() as password login; everything downstream is unchanged.
  completeOidc(code: string): Observable<AuthResponse> {
    return this.api
      .post<AuthResponse, ExchangeOidcCodeDto>('/auth/oidc/exchange', { code })
      .pipe(tap((res) => this.persistSession(res)));
  }

  me(): Observable<{ user: UserProfile }> {
    return this.api.get<{ user: UserProfile }>('/users/me').pipe(
      tap((res) => {
        this.userSignal.set(res.user);
      }),
    );
  }

  updateProfile(dto: UpdateUserDto): Observable<{ user: UserProfile }> {
    return this.api.patch<{ user: UserProfile }, UpdateUserDto>('/users/me', dto).pipe(
      tap((res) => this.userSignal.set(res.user)),
    );
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.userSignal.set(null);
    this.router.navigateByUrl('/login');
  }

  private persistSession(res: AuthResponse) {
    localStorage.setItem(TOKEN_KEY, res.token);
    this.userSignal.set(res.user);
  }
}
