/**
 * Ambient globals for the serverless runtime.
 *
 * api/tsconfig.json sets `"types": []` so no @types package (jasmine, node,
 * ...) leaks into this compile. The web globals the functions use (fetch,
 * AbortController, Response, setTimeout, console) come from lib "DOM"; the one
 * Node-only global they need is `process.env`, declared here structurally.
 */
declare var process: { env: Record<string, string | undefined> };
