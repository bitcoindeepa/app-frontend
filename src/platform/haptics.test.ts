// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hapticFeedback = vi.hoisted(() => ({
  isSupported: vi.fn(),
  impactOccurred: vi.fn(),
  notificationOccurred: vi.fn(),
  selectionChanged: vi.fn(),
}));
vi.mock("@tma.js/sdk", () => ({ hapticFeedback }));

import { haptic, lastHapticAt, tapHaptic } from "@/platform/haptics";

const vibrate = vi.fn(() => true);
let reducedMotion: boolean;

beforeEach(() => {
  Object.values(hapticFeedback).forEach((mock) => mock.mockReset());
  vibrate.mockClear();
  reducedMotion = false;
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
  }));
});

afterEach(() => {
  delete (navigator as { vibrate?: unknown }).vibrate;
});

describe("inside Telegram", () => {
  beforeEach(() => {
    hapticFeedback.isSupported.mockReturnValue(true);
  });

  it("uses Telegram's own haptics, not the vibration motor", () => {
    haptic.impact("heavy");
    haptic.notify("success");
    haptic.select();
    expect(hapticFeedback.impactOccurred).toHaveBeenCalledExactlyOnceWith("heavy");
    expect(hapticFeedback.notificationOccurred).toHaveBeenCalledExactlyOnceWith("success");
    expect(hapticFeedback.selectionChanged).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("defaults an impact to medium", () => {
    haptic.impact();
    expect(hapticFeedback.impactOccurred).toHaveBeenCalledExactlyOnceWith("medium");
  });
});

describe("on the web", () => {
  beforeEach(() => {
    // what the SDK does outside Telegram
    hapticFeedback.isSupported.mockImplementation(() => {
      throw new Error("SDK is not initialized");
    });
  });

  it.each([
    ["soft", 6],
    ["light", 6],
    ["medium", 10],
    ["rigid", 14],
    ["heavy", 18],
  ] as const)("vibrates for a %s impact", (style, ms) => {
    haptic.impact(style);
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(ms);
  });

  it.each([
    ["success", [10, 50, 20]],
    ["warning", 18],
    ["error", [8, 40, 8]],
  ] as const)("vibrates a pattern for a %s notification", (type, pattern) => {
    haptic.notify(type);
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(pattern);
  });

  it("ticks for a selection and for a plain tap", () => {
    haptic.select();
    tapHaptic();
    expect(vibrate.mock.calls).toEqual([[6], [6]]);
  });

  it("stays still when the user prefers reduced motion", () => {
    reducedMotion = true;
    haptic.impact("heavy");
    haptic.notify("error");
    tapHaptic();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does nothing where there is no vibration API (iOS)", () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    expect(() => haptic.notify("success")).not.toThrow();
  });

  it("survives a browser that refuses to vibrate without a recent tap", () => {
    vibrate.mockImplementationOnce(() => {
      throw new Error("Blocked");
    });
    expect(() => haptic.impact()).not.toThrow();
  });

  it("falls back to vibration on a Telegram client without haptics", () => {
    hapticFeedback.isSupported.mockReset().mockReturnValue(false);
    haptic.impact("light");
    expect(hapticFeedback.impactOccurred).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(6);
  });
});

describe("lastHapticAt", () => {
  it("notes a screen's own haptic, so the app-wide tap haptic can skip that tap", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(1_000);
    haptic.impact();
    expect(lastHapticAt()).toBe(1_000);

    now.mockReturnValue(2_000);
    haptic.notify("success");
    expect(lastHapticAt()).toBe(2_000);

    now.mockReturnValue(3_000);
    haptic.select();
    expect(lastHapticAt()).toBe(3_000);
  });

  it("isn't moved by the app-wide tap haptic itself", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(4_000);
    haptic.select();
    now.mockReturnValue(5_000);
    tapHaptic();
    expect(lastHapticAt()).toBe(4_000);
  });
});
