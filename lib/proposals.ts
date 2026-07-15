"use client";

/**
 * Phase 5: proposed-workflow registry (client-side demo gate).
 *
 * The Committee viewpoint (Wael) can draft rules but may not activate them —
 * saving registers the workflow as a `proposed` draft that an Admin must
 * approve. There is no `status` column on the Workflow model, and this is
 * demo-only permission theatre (server routes enforce the rules that matter),
 * so we track the proposed set in localStorage rather than migrating the DB.
 *
 * Convention: a proposed workflow is persisted with `enabled = false` and its id
 * recorded here. Admin approval clears it (and enables the workflow).
 */

import { useEffect, useState } from "react";

const KEY = "wf-proposed-ids";
const EVENT = "wf-proposed-change";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function write(set: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* best effort */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function getProposedIds(): Set<string> {
  return read();
}

export function isProposed(id: string): boolean {
  return read().has(id);
}

export function markProposed(id: string) {
  const set = read();
  if (!set.has(id)) {
    set.add(id);
    write(set);
  }
}

/** Admin approval (or deletion) clears the proposed flag. */
export function clearProposed(id: string) {
  const set = read();
  if (set.delete(id)) {
    write(set);
  }
}

/** Live-updating view of the proposed id set for React components. */
export function useProposedIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setIds(read());
    const onChange = () => setIds(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) onChange();
    });
    return () => {
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  return ids;
}
