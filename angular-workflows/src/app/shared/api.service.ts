import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from './app-config';

/**
 * Mirror of the admin console's `ApiService` HTTP contract, per the 2026-07-16
 * live source-map scan ("Auth & Interceptor Contracts").
 *
 * Every request carries, beyond the bearer:
 *   x-landjourney-agent: web
 *   x-session-id: <created once per browser session, sessionStorage>
 *   x-landjourney-app-type: backoffice
 *   x-organization: <UI-configuration dnsPrefix>
 *
 * Hand-rolled `fetch` is prohibited — it bypasses this contract (scan §2, and
 * the July-14 lesson: a bare bearer gets a 500). In the admin monorepo this
 * class is replaced by the real `ApiService`; the surface is kept deliberately
 * small (get/post/put/delete against a service prefix) so the swap is
 * mechanical.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(APP_CONFIG);

  /** Session id, created once per browser session — matches the admin app. */
  private sessionId(): string {
    const KEY = 'sessionId';
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({
      authorization: `Bearer ${this.config.token}`,
      'x-landjourney-agent': 'web',
      'x-session-id': this.sessionId(),
      'x-landjourney-app-type': 'backoffice',
      'x-organization': this.config.organization,
    });
  }

  /** `service` is the domain prefix: "workflows" | "documents" | "products" | "iam" | "data". */
  private url(service: string, path: string): string {
    return `${this.config.apiBase}/${service}${path.startsWith('/') ? path : `/${path}`}`;
  }

  get<T>(service: string, path: string): Observable<T> {
    return this.http.get<T>(this.url(service, path), { headers: this.headers() });
  }

  post<T>(service: string, path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.url(service, path), body, { headers: this.headers() });
  }

  put<T>(service: string, path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.url(service, path), body, { headers: this.headers() });
  }

  delete<T>(service: string, path: string): Observable<T> {
    return this.http.delete<T>(this.url(service, path), { headers: this.headers() });
  }
}
