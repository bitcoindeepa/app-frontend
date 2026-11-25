"use client";

import { useEffect } from "react";
import { cn } from "cn";
import { haptic } from "@/platform";
import { PASSCODE_LENGTH } from "@/lib/passcode";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/**
 * Six dots and a phone-style keypad. Controlled: `onChange` gets the new
 * digits (never more than six); the parent acts once there are six.
 * A physical keyboard works too (digits, Backspace). Bump `shakeKey` to
 * shake the dots after a wrong code.
 */
export function PasscodePad({
  value,
  onChange,
  disabled,
  shakeKey = 0,
  label = "Passcode",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  shakeKey?: number;
  label?: string;
}) {
  const press = (key: (typeof KEYS)[number]) => {
    if (disabled || !key) return;
    if (key === "back") {
      if (!value) return;
      haptic.select();
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= PASSCODE_LENGTH) return;
    haptic.select();
    onChange(value + key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Leave real text fields alone (e.g. a sheet behind the lock screen)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
      else if (e.key === "Backspace") press("back");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div
        key={shakeKey}
        role="status"
        aria-label={`${label}: ${value.length} of ${PASSCODE_LENGTH} digits entered`}
        className={cn("flex gap-4", shakeKey > 0 && "animate-shake")}
      >
        {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "size-3.5 rounded-full transition-colors duration-150",
              i < value.length ? "bg-foreground" : "bg-line"
            )}
          />
        ))}
      </div>
      <div className="grid w-full max-w-[300px] grid-cols-3 gap-x-6 gap-y-3">
        {KEYS.map((key, i) =>
          key === "" ? (
            <span key={i} aria-hidden />
          ) : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-label={key === "back" ? "Delete" : key}
              onClick={() => press(key)}
              className={cn(
                "press flex h-16 items-center justify-center rounded-full border-0 select-none disabled:opacity-40",
                key === "back"
                  ? "text-ink2 bg-transparent"
                  : "bg-chip text-foreground font-display text-[26px] font-bold"
              )}
            >
              {key === "back" ? (
                <svg
                  className="size-7"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
                  <path d="M17 9l-5 6M12 9l5 6" />
                </svg>
              ) : (
                key
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
