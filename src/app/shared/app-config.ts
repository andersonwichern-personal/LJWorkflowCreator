import { InjectionToken } from '@angular/core';

/**
 * Deploy-time configuration for the workflows feature.
 *
 * In the admin monorepo this token disappears: the real `ApiService`,
 * organization context (UI-configuration `dnsPrefix`), and auth are provided
 * by the shell. It exists here so the standalone workspace can run against
 * either the mock backend (no token) or `api-test.landjourney.ai` (token
 * supplied at bootstrap) without touching feature code.
 */
export interface AppConfig {
  /** Service origin, e.g. "https://api-test.landjourney.ai". Empty = mock. */
  apiBase: string;
  /** Bearer token from an authenticated admin session. Empty = mock. */
  token: string;
  /**
   * Tenant context sent as `x-organization`. This is the UI-configuration
   * `dnsPrefix` (from GET /organizations/external/ui-configuration), NOT an
   * org UUID — the prototype's `orgId` query/body tenancy does not carry over.
   */
  organization: string;
  /**
   * Same-origin base for the AI endpoints (chat / parse-ai serverless
   * functions), independent of `apiBase` and mock mode: mock mode disables the
   * Landjourney backend, not the AI lane — which fails closed onto its
   * deterministic fallbacks whenever the endpoints are absent. Empty/undefined
   * disables the AI transport entirely.
   */
  aiBase?: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: (): AppConfig => ({
    apiBase: '',
    token: '',
    organization: 'organic-bank-of-america',
    aiBase: '/api',
  }),
});

/** True when no live credentials are configured — the mock backend serves. */
export function isMockMode(config: AppConfig): boolean {
  return !config.apiBase || !config.token;
}
