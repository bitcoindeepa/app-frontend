// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import { telegramPlatform, webPlatform } from "@/test/platform";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
const backButton = vi.hoisted(() => ({
  isSupported: vi.fn(),
  isMounted: vi.fn(),
  mount: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  onClick: vi.fn(),
}));
vi.mock("@tma.js/sdk", () => ({ backButton }));
vi.mock("@/platform/PlatformProvider", () => ({ usePlatform: () => platform.current }));

import { useBackButton } from "@/platform/useBackButton";

const off = vi.fn();
/** The user taps Telegram's back chevron */
const tapBack = () => (backButton.onClick.mock.calls.at(-1)?.[0] as () => void)();

beforeEach(() => {
  platform.current = telegramPlatform();
  Object.values(backButton).forEach((mock) => mock.mockReset());
  off.mockReset();
  backButton.isSupported.mockReturnValue(true);
  backButton.isMounted.mockReturnValue(false);
  backButton.onClick.mockReturnValue(off);
});

afterEach(() => cleanup());

describe("useBackButton", () => {
  it("shows Telegram's back button and wires it to the page", () => {
    const onBack = vi.fn();
    renderHook(() => useBackButton(onBack));
    expect(backButton.mount).toHaveBeenCalledTimes(1);
    expect(backButton.show).toHaveBeenCalledTimes(1);

    tapBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides it and stops listening when the page goes away", () => {
    const { unmount } = renderHook(() => useBackButton(vi.fn()));
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
    expect(backButton.hide).toHaveBeenCalledTimes(1);
  });

  it("calls the page's latest handler without showing the button again", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onBack }) => useBackButton(onBack), {
      initialProps: { onBack: first },
    });
    rerender({ onBack: second });

    tapBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(backButton.show).toHaveBeenCalledTimes(1);
    expect(backButton.hide).not.toHaveBeenCalled();
  });

  it("doesn't mount a button that is already mounted", () => {
    backButton.isMounted.mockReturnValue(true);
    renderHook(() => useBackButton(vi.fn()));
    expect(backButton.mount).not.toHaveBeenCalled();
    expect(backButton.show).toHaveBeenCalledTimes(1);
  });

  it("can be switched off, and back on", () => {
    const { rerender } = renderHook(({ enabled }) => useBackButton(vi.fn(), enabled), {
      initialProps: { enabled: false },
    });
    expect(backButton.show).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(backButton.show).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    expect(backButton.hide).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the web, where pages draw their own back button", () => {
    platform.current = webPlatform();
    renderHook(() => useBackButton(vi.fn()));
    expect(backButton.isSupported).not.toHaveBeenCalled();
    expect(backButton.show).not.toHaveBeenCalled();
  });

  it("does nothing on a client without a back button", () => {
    backButton.isSupported.mockReturnValue(false);
    renderHook(() => useBackButton(vi.fn()));
    expect(backButton.show).not.toHaveBeenCalled();
  });

  it("survives an SDK that isn't ready", () => {
    backButton.isSupported.mockImplementation(() => {
      throw new Error("SDK is not initialized");
    });
    expect(() => renderHook(() => useBackButton(vi.fn()))).not.toThrow();
  });
});
