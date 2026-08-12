import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly base = API_BASE_URL;

  get<T>(path: string, params?: Record<string, string | number | boolean>): Observable<T> {
    const httpParams =
      params !== undefined
        ? new HttpParams({ fromObject: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
        : undefined;
    return this.http.get<T>(`${this.base}${path}`, { params: httpParams });
  }

  post<T, B = unknown>(path: string, body: B): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body);
  }

  patch<T, B = unknown>(path: string, body: B): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body);
  }

  put<T, B = unknown>(path: string, body: B): Observable<T> {
    return this.http.put<T>(`${this.base}${path}`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.base}${path}`);
  }

  getBlob(path: string): Observable<Blob> {
    return this.http.get(`${this.base}${path}`, { responseType: 'blob' });
  }
}
