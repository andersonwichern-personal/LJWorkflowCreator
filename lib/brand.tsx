"use client";

/**
 * Phase 5: brand theming (updated to the LandJourney brand).
 *
 * Two brand colours plus a logo, persisted to localStorage:
 *   - primary  (#133C14, dark green)  → chrome: the sidebar rail (--brand-primary)
 *   - secondary(#1CBE73, bright green) → the interactive accent (--accent / -soft / -ring)
 * On mount and on every change we convert the secondary to HSL accent tokens and
 * write both onto <html> so the whole console re-themes live.
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

/** LandJourney brand defaults. */
export const DEFAULT_PRIMARY_COLOR = "#133c14"; // dark forest green — chrome
export const DEFAULT_SECONDARY_COLOR = "#1cbe73"; // bright green — accent
export const DEFAULT_LOGO_URL =
  "https://landjourney.ai/images/BYCZrp4YIVakhtkfw0tOCj9bSY.png";

export interface BrandConfig {
  /** Primary brand colour (`#rrggbb`) — drives chrome (sidebar rail). */
  primary: string;
  /** Secondary brand colour (`#rrggbb`) — drives the interactive accent. */
  secondary: string;
  /** Logo image URL rendered in the sidebar header. */
  logoUrl: string;
}

export const DEFAULT_BRAND: BrandConfig = {
  primary: DEFAULT_PRIMARY_COLOR,
  secondary: DEFAULT_SECONDARY_COLOR,
  logoUrl: DEFAULT_LOGO_URL,
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

/** Imperatively write the brand tokens (accent + chrome primary) on <html>. */
export function applyBrand(brand: BrandConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const accent = accentTokensFor(brand.secondary);
  if (accent) {
    for (const [key, value] of Object.entries(accent)) root.style.setProperty(key, value);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--ring");
  }

  const primary = normalizeHex(brand.primary);
  if (primary) root.style.setProperty("--brand-primary", primary);
  else root.style.removeProperty("--brand-primary");
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

interface BrandValue {
  brand: BrandConfig;
  setPrimary: (hex: string) => void;
  setSecondary: (hex: string) => void;
  setLogoUrl: (url: string) => void;
  reset: () => void;
}

const BrandContext = createContext<BrandValue>({
  brand: DEFAULT_BRAND,
  setPrimary: () => {},
  setSecondary: () => {},
  setLogoUrl: () => {},
  reset: () => {},
});

function readStored(): BrandConfig {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (!raw) return DEFAULT_BRAND;
    const parsed = JSON.parse(raw) as Partial<BrandConfig> & { color?: string };
    return {
      // Migrate the legacy single-colour shape ({ color }) → secondary.
      secondary:
        normalizeHex(parsed.secondary ?? parsed.color ?? "") ?? DEFAULT_SECONDARY_COLOR,
      primary: normalizeHex(parsed.primary ?? "") ?? DEFAULT_PRIMARY_COLOR,
      logoUrl: typeof parsed.logoUrl === "string" ? parsed.logoUrl : DEFAULT_LOGO_URL,
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
    applyBrand(stored);
  }, []);

  // Keep tokens + storage in lockstep with state on every change.
  useEffect(() => {
    applyBrand(brand);
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    } catch {
      /* private mode — theme still applies for this session */
    }
  }, [brand]);

  const setPrimary = useCallback((hex: string) => {
    setBrand((b) => ({ ...b, primary: normalizeHex(hex) ?? hex }));
  }, []);

  const setSecondary = useCallback((hex: string) => {
    setBrand((b) => ({ ...b, secondary: normalizeHex(hex) ?? hex }));
  }, []);

  const setLogoUrl = useCallback((url: string) => {
    setBrand((b) => ({ ...b, logoUrl: url }));
  }, []);

  const reset = useCallback(() => {
    setBrand(DEFAULT_BRAND);
  }, []);

  const value = useMemo<BrandValue>(
    () => ({ brand, setPrimary, setSecondary, setLogoUrl, reset }),
    [brand, setPrimary, setSecondary, setLogoUrl, reset]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandValue {
  return useContext(BrandContext);
}
