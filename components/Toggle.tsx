"use client";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

/** Accessible on/off switch with a soft sliding thumb. */
export default function Toggle({
  checked,
  onChange,
  label,
  size = "md",
  disabled = false,
}: ToggleProps) {
  const w = size === "sm" ? 34 : 44;
  const h = size === "sm" ? 20 : 26;
  const knob = h - 6;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="ring-accent relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200"
      style={{
        width: w,
        height: h,
        background: checked ? "var(--accent)" : "var(--tok-op-bg)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="absolute rounded-full bg-white shadow transition-transform duration-200"
        style={{
          width: knob,
          height: knob,
          top: 3,
          left: 3,
          transform: checked ? `translateX(${w - knob - 6}px)` : "translateX(0)",
        }}
      />
    </button>
  );
}
