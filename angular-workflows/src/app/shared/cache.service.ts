import { Injectable } from '@angular/core';

/**
 * Draft storage, mirroring the admin console's Dynamic Form builder contract
 * (scan §3 "Draft Auto-Save"): drafts live in localStorage under a single
 * feature key, auto-saved on an interval, keyed by record id with a sentinel
 * for unsaved records. The admin repo routes this through its `CacheService`
 * envelope (`$%$v02$%$` serializer) — do NOT read these keys with a raw
 * JSON.parse over there; this standalone class is the seam to swap.
 */
@Injectable({ providedIn: 'root' })
export class CacheService {
  read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota/private mode — drafts are best-effort */
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export const WORKFLOW_DRAFTS_KEY = 'workflowCreatorDrafts';
export const NEW_WORKFLOW_ID = 'NEW_WORKFLOW_ID';
export const DRAFT_AUTOSAVE_MS = 2000;
