/**
 * Ambient minimums for the two host primitives the Brain's tsconfig wall
 * (lib ES2022, no DOM, no ambient types) does not provide:
 *
 * - AbortSignal: ports accept caller-owned abort signals; the Brain only reads
 *   `aborted` and (un)subscribes to the "abort" event.
 * - setTimeout/clearTimeout: the one scheduling primitive the orchestrator may
 *   use (documented at orchestrator.ts callWithTimeout).
 *
 * Declarations are deliberately minimal and structurally compatible with
 * lib.dom, so the vendored copy under src/app/brain merges cleanly into the
 * Angular compile. Nothing here widens the wall: document, window, fetch,
 * storage, and every other host global stay unavailable.
 */
declare global {
  interface AbortSignal {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
  }
  function setTimeout(handler: () => void, timeoutMs?: number): number;
  function clearTimeout(id?: number): void;
}
export {};
