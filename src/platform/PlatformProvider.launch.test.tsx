// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// A page whose URL carries Telegram launch params: opened by Telegram, or a
// Mini App link pasted into a normal browser.
const LAUNCH = vi.hoisted(() => ({ initDataRaw: "query_id=AAF1&hash=abc", raw: {} }));
const sdk = vi.hoisted(() => ({ isTMA: vi.fn(), request2: vi.fn() }));
const telegram = vi.hoisted(() => ({
  readLaunch: vi.fn(() => LAUNCH),
  setupTelegram: vi.fn(),
  createTelegramPlatform: vi.fn((launch: unknown = LAUNCH) => ({ kind: "telegram", launch })),
}));
vi.mock("@tma.js/sdk", () => sdk);
vi.mock("@/platform/telegram", () => telegram);

import { PlatformProvider, usePlatform } from "@/platform/PlatformProvider";

/** Opens the page; `seen` is every platform value the app was rendered with */
function open() {
  const seen: unknown[] = [];
  const view = renderHook(
    () => {
      const platform = usePlatform();
      if (seen.at(-1) !== platform) seen.push(platform);
      return platform;
    },
    { wrapper: PlatformProvider }
  );
  return { ...view, seen };
}

beforeEach(() => {
  sdk.isTMA.mockReset();
  sdk.request2.mockReset();
  telegram.setupTelegram.mockClear();
});

afterEach(() => cleanup());

describe("PlatformProvider, opened with Telegram launch params", () => {
  it("is Telegram straight away, and drops Telegram's placeholder without waiting", async () => {
    sdk.isTMA.mockReturnValue(new Promise(() => {}));
    const { result } = open();
    expect(result.current.kind).toBe("telegram");
    expect(result.current.launch).toBe(LAUNCH);
    expect(telegram.setupTelegram).toHaveBeenCalledTimes(1);
  });

  it("keeps the same platform once Telegram confirms, so nothing re-renders", async () => {
    sdk.isTMA.mockResolvedValue(true);
    const { seen } = open();
    await waitFor(() => expect(telegram.setupTelegram).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toHaveLength(1);
  });

  it("stays Telegram when the quick check misses but the page is in Telegram Web's iframe", async () => {
    sdk.isTMA.mockResolvedValue(false);
    vi.stubGlobal("top", {});
    const { result } = open();
    await waitFor(() => expect(telegram.setupTelegram).toHaveBeenCalledTimes(2));
    expect(result.current.kind).toBe("telegram");
    expect(sdk.request2).not.toHaveBeenCalled();
  });

  it("asks Telegram once more, with a longer wait, before giving up", async () => {
    sdk.isTMA.mockResolvedValue(false);
    sdk.request2.mockResolvedValue({});
    const { result } = open();
    await waitFor(() => expect(telegram.setupTelegram).toHaveBeenCalledTimes(2));
    expect(sdk.request2).toHaveBeenCalledExactlyOnceWith("web_app_request_theme", "theme_changed", {
      timeout: 2000,
    });
    expect(result.current.kind).toBe("telegram");
  });

  it("is the web when nothing answers: launch params alone don't make it Telegram", async () => {
    sdk.isTMA.mockResolvedValue(false);
    sdk.request2.mockRejectedValue(new Error("timeout"));
    const { result } = open();
    // the first guess was Telegram
    expect(result.current.kind).toBe("telegram");

    await waitFor(() => expect(result.current.kind).toBe("web"));
    // and the copied initData is not offered to the app as a login
    expect(result.current.launch).toBeNull();
  });
});
