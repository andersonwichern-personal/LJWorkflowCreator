"use client";

/**
 * Phase 5: brand theming.
 *
 * Lets a user pick a primary brand colour (hex) and a logo URL, persists both to
 * localStorage, and re-themes the whole app by writing HSL tokens onto
 * <html> (`--accent`, `--accent-soft`, `--ring`) on mount and on every change.
 *
 * Honesty guardrail: this is a client-side demo customiser. Nothing here changes
 * server behaviour — it only restyles the console for the person viewing it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const BRAND_KEY = "wf-brand";

/** Landjourney admin teal — the shipped default when nothing is stored. */
export const DEFAULT_BRAND_COLOR = "#4fc6a5";

export interface BrandConfig {
  /** Primary brand colour as a `#rrggbb` hex string. */
  color: string;
  /** Optional logo image URL rendered in the sidebar header. */
  logoUrl: string;
}

export const DEFAULT_BRAND: BrandConfig = {
  color: DEFAULT_BRAND_COLOR,
  logoUrl: "",
};

/* -------------------------------------------------------------------------- */
/* Colour math — hex → HSL, so we can emit `hsl(H S% L% / a)` accent tokens.   */
/* -------------------------------------------------------------------------- */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Normalise loose user input (`abc`, `#abc`, `4fc6a5`) to `#rrggbb` or null. */
export function normalizeHex(input: string): string | null {
  if (!input) return null;
  let v = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) {
    v = v
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/.test(v)) return null;
  return `#${v}`;
}

export function hexToHsl(hex: string): Hsl | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** The three accent tokens the whole theme keys off, derived from one colour. */
export function accentTokensFor(hex: string): Record<string, string> | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const base = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
  return {
    "--accent": `hsl(${base})`,
    "--accent-soft": `hsl(${base} / 0.12)`,
    "--ring": `hsl(${base} / 0.4)`,
  };
}

/** Imperatively write (or clear) the accent tokens on the document root. */
export function applyBrandColor(hex: string) {
  if (typeof document === "undefined") return;
  const tokens = accentTokensFor(hex);
  const root = document.documentElement;
  if (!tokens) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--ring");
    return;
  }
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

interface BrandValue {
  brand: BrandConfig;
  setColor: (hex: string) => void;
  setLogoUrl: (url: string) => void;
  reset: () => void;
}

const BrandContext = createContext<BrandValue>({
  brand: DEFAULT_BRAND,
  setColor: () => {},
  setLogoUrl: () => {},
  reset: () => {},
});

function readStored(): BrandConfig {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (!raw) return DEFAULT_BRAND;
    const parsed = JSON.parse(raw) as Partial<BrandConfig>;
    return {
      color: normalizeHex(parsed.color ?? "") ?? DEFAULT_BRAND_COLOR,
      logoUrl: typeof parsed.logoUrl === "string" ? parsed.logoUrl : "",
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND);

  // Rehydrate after mount (SSR-safe) and paint the tokens immediately.
  useEffect(() => {
    const stored = readStored();
    setBrand(stored);
    if (stored.color !== DEFAULT_BRAND_COLOR) applyBrandColor(stored.color);
  }, []);

  // Keep tokens + storage in lockstep with state on every change.
  useEffect(() => {
    applyBrandColor(brand.color);
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    } catch {
      /* private mode — theme still applies for this session */
    }
  }, [brand]);

  const setColor = useCallback((hex: string) => {
    const norm = normalizeHex(hex);
    setBrand((b) => ({ ...b, color: norm ?? hex }));
  }, []);

  const setLogoUrl = useCallback((url: string) => {
    setBrand((b) => ({ ...b, logoUrl: url }));
  }, []);

  const reset = useCallback(() => {
    setBrand(DEFAULT_BRAND);
  }, []);

  const value = useMemo<BrandValue>(
    () => ({ brand, setColor, setLogoUrl, reset }),
    [brand, setColor, setLogoUrl, reset]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandValue {
  return useContext(BrandContext);
}
