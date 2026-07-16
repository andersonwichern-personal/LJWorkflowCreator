/**
 * Phase 7.2: A/B split-test routing.
 *
 * Deterministic traffic splitter: a request's id hashes to a stable bucket in
 * [0, 100), and the request routes to the peer rule when its bucket falls under
 * `weightPercent`. Same request → same branch, always — no Math.random, so
 * simulations are reproducible and a request never flip-flops between versions.
 */

/** Stable string hash → bucket in [0, 100). */
export function hashToPercent(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/** Does this request fall in the peer's traffic share? */
export function routesToPeer(requestId: string, weightPercent: number): boolean {
  return hashToPercent(requestId) < weightPercent;
}
