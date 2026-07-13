"use client";

import { useEffect, useState } from "react";

/** Light/dark switch that persists to localStorage and flips [data-theme]. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as "light" | "dark") ||
      "light";
    setTheme(current);
  }, []);

  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("wf-theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label="Toggle color theme"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="ring-accent glass flex h-9 w-9 items-center justify-center rounded-xl text-base transition-transform duration-200 hover:scale-105"
    >
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
