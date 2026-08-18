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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly userSignal = signal<UserProfile | null>(null);

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
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
