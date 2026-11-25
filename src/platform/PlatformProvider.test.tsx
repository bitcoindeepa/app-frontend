// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// A plain browser: no Telegram launch params in the URL. (The provider reads
// them once per page load, so the launched case has its own file.)
const sdk = vi.hoisted(() => ({ isTMA: vi.fn(), request2: vi.fn() }));
const telegram = vi.hoisted(() => ({
  readLaunch: vi.fn(() => null),
  setupTelegram: vi.fn(),
  createTelegramPlatform: vi.fn(() => ({ kind: "telegram", launch: null })),
}));
vi.mock("@tma.js/sdk", () => sdk);
vi.mock("@/platform/telegram", () => telegram);

import { PlatformProvider, usePlatform } from "@/platform/PlatformProvider";

const open = () => renderHook(() => usePlatform(), { wrapper: PlatformProvider });

beforeEach(() => {
  sdk.isTMA.mockReset();
  sdk.request2.mockReset();
  telegram.setupTelegram.mockClear();
  telegram.createTelegramPlatform.mockClear();
});

afterEach(() => cleanup());

describe("PlatformProvider, opened in a browser", () => {
  it("is undecided at first, then the web", async () => {
    sdk.isTMA.mockResolvedValue(false);
    const { result } = open();
    expect(result.current.kind).toBeNull();

    await waitFor(() => expect(result.current.kind).toBe("web"));
    expect(result.current.launch).toBeNull();
    expect(sdk.isTMA).toHaveBeenCalledWith("complete");
    // without launch params the quick check is enough
    expect(sdk.request2).not.toHaveBeenCalled();
    expect(telegram.setupTelegram).not.toHaveBeenCalled();
  });

  it("is the web when the Telegram check itself fails", async () => {
    sdk.isTMA.mockRejectedValue(new Error("no bridge"));
    const { result } = open();
    await waitFor(() => expect(result.current.kind).toBe("web"));
  });

  it("is Telegram when Telegram answers, even without launch params", async () => {
    sdk.isTMA.mockResolvedValue(true);
    const { result } = open();
    await waitFor(() => expect(result.current.kind).toBe("telegram"));
    expect(telegram.setupTelegram).toHaveBeenCalledTimes(1);
    expect(telegram.createTelegramPlatform).toHaveBeenCalledTimes(1);
  });

  it("gives the web platform outside a provider, undecided", () => {
    const { result } = renderHook(() => usePlatform());
    expect(result.current.kind).toBeNull();
  });
});
