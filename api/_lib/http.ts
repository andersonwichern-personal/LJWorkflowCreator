/**
 * Minimal structural types for Vercel's Node serverless runtime.
 *
 * @vercel/node's real types are deliberately NOT installed (no new npm
 * dependencies). The handlers only touch this tiny surface: Vercel's runtime
 * auto-parses JSON request bodies into `req.body`, and `res` is Node's
 * ServerResponse with Vercel's `status`/`json` helpers attached. Declaring the
 * shape structurally keeps `npx tsc -p api/tsconfig.json` self-contained and
 * still matches the real objects at runtime.
 */

export interface ApiRequest {
  method?: string;
  /** Vercel parses JSON request bodies automatically. Treat as UNTRUSTED. */
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  /** Chainable, mirroring Vercel's helper: `res.status(200).json(...)`. */
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string | readonly string[]): void;
}
