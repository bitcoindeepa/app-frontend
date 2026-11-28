// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Telegram SDK, replaced: each test says what the client supports
const sdk = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    init: fn(),
    isColorDark: fn((hex: string) => hex.toLowerCase() < "#888888"),
    on: fn(),
    openLink: fn(),
    openTelegramLink: fn(),
    popup: { show: fn() },
    postEvent: fn(),
    requestWriteAccess: fn(),
    retrieveLaunchParams: fn(),
    retrieveRawInitData: fn(),
    shareStory: fn(),
    shareURL: fn(),
    swipeBehavior: { isSupported: fn(), isMounted: fn(), mount: fn(), disableVertical: fn() },
    deepSnakeToCamelObjKeys: fn((value: unknown) => camel(value)),
  };

  function camel(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(camel);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key.replace(/_(\w)/g, (_match, letter: string) => letter.toUpperCase()),
        camel(inner),
      ])
    );
  }
});
vi.mock("@tma.js/sdk", () => sdk);

import type { TelegramLaunch } from "@/platform/types";

const INIT_DATA = "query_id=AAF1&user=%7B%22id%22%3A777%7D&auth_date=1795667400&hash=abc";

const unsupported = () => {
  throw new Error("Method is unsupported on this client");
};

/** A fresh copy of the module: setupTelegram remembers that it has run */
async function load() {
  vi.resetModules();
  return import("@/platform/telegram");
}

const launchOn = (clientPlatform: string, bgColor?: string): TelegramLaunch => ({
  initDataRaw: INIT_DATA,
  clientPlatform,
  raw: { themeParams: { bgColor } },
});

async function telegram(launch: TelegramLaunch = launchOn("android")) {
  const { createTelegramPlatform } = await load();
  return createTelegramPlatform(launch);
}

beforeEach(() => {
  // back to what vi.fn() was created with, calls forgotten
  for (const value of Object.values(sdk)) {
    if (typeof value === "function") value.mockReset();
    else Object.values(value).forEach((inner) => inner.mockReset());
  }
  sdk.retrieveRawInitData.mockReturnValue(INIT_DATA);
  sdk.retrieveLaunchParams.mockReturnValue({
    tgWebAppData: {
      user: {
        id: 777,
        username: "nimal_tg",
        first_name: "Nimal",
        last_name: "Silva",
        photo_url: "https://t.me/i/userpic/320/nimal.jpg",
        language_code: "en",
      },
      auth_date: 1795667400,
      hash: "abc",
    },
    tgWebAppPlatform: "ios",
    tgWebAppVersion: "9.1",
    tgWebAppThemeParams: { bg_color: "#ffffff" },
    tgWebAppStartParam: "FRIEND7",
    tgWebAppBotInline: false,
  });
});

describe("readLaunch", () => {
  it("reads what Telegram opened the Mini App with", async () => {
    const { readLaunch } = await load();
    const launch = readLaunch();
    expect(launch?.initDataRaw).toBe(INIT_DATA);
    expect(launch?.clientPlatform).toBe("ios");
    expect(launch?.user).toEqual({
      id: 777,
      username: "nimal_tg",
      firstName: "Nimal",
      lastName: "Silva",
      photoUrl: "https://t.me/i/userpic/320/nimal.jpg",
    });
    expect(launch?.raw).toMatchObject({
      initDataRaw: INIT_DATA,
      platform: "ios",
      version: "9.1",
      themeParams: { bgColor: "#ffffff" },
      startParam: "FRIEND7",
      botInline: false,
    });
  });

  it("is null in a plain browser, where there are no launch params", async () => {
    sdk.retrieveLaunchParams.mockImplementation(() => {
      throw new Error("Unable to retrieve launch parameters");
    });
    const { readLaunch } = await load();
    expect(readLaunch()).toBeNull();
  });

  it("copes with launch params that carry no user", async () => {
    sdk.retrieveLaunchParams.mockReturnValue({ tgWebAppPlatform: "weba", tgWebAppThemeParams: {} });
    const { readLaunch } = await load();
    const launch = readLaunch();
    expect(launch?.user).toBeUndefined();
    expect(launch?.initData).toBeUndefined();
    expect(launch?.clientPlatform).toBe("weba");
  });
});

describe("setupTelegram", () => {
  it("starts the SDK, drops Telegram's placeholder, expands and stops swipe-to-close", async () => {
    sdk.swipeBehavior.isSupported.mockReturnValue(true);
    sdk.swipeBehavior.isMounted.mockReturnValue(false);
    const { setupTelegram } = await load();

    setupTelegram();

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.postEvent.mock.calls).toEqual([["web_app_ready"], ["web_app_expand"]]);
    expect(sdk.swipeBehavior.mount).toHaveBeenCalledTimes(1);
    expect(sdk.swipeBehavior.disableVertical).toHaveBeenCalledTimes(1);
  });

  it("starts the SDK once, but tells Telegram it's ready each time", async () => {
    const { setupTelegram } = await load();
    setupTelegram();
    setupTelegram();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.postEvent).toHaveBeenCalledTimes(4);
  });

  it("tries the SDK again next time when starting it failed", async () => {
    sdk.init.mockImplementationOnce(unsupported);
    const { setupTelegram } = await load();
    setupTelegram();
    setupTelegram();
    expect(sdk.init).toHaveBeenCalledTimes(2);
  });

  it("doesn't mount the swipe control twice", async () => {
    sdk.swipeBehavior.isSupported.mockReturnValue(true);
    sdk.swipeBehavior.isMounted.mockReturnValue(true);
    const { setupTelegram } = await load();
    setupTelegram();
    expect(sdk.swipeBehavior.mount).not.toHaveBeenCalled();
    expect(sdk.swipeBehavior.disableVertical).toHaveBeenCalledTimes(1);
  });

  it("survives an old client that supports none of it", async () => {
    sdk.init.mockImplementation(unsupported);
    sdk.postEvent.mockImplementation(unsupported);
    sdk.swipeBehavior.isSupported.mockImplementation(unsupported);
    const { setupTelegram } = await load();
    expect(() => setupTelegram()).not.toThrow();
  });
});

describe("createTelegramPlatform", () => {
  it("is Telegram, with the launch data and stories", async () => {
    const launch = launchOn("ios");
    const platform = await telegram(launch);
    expect(platform.kind).toBe("telegram");
    expect(platform.launch).toBe(launch);
    expect(platform.capabilities.stories).toBe(true);
  });

  it.each([
    ["ios", true],
    ["android", true],
    ["android_x", true],
    ["tdesktop", false],
    ["macos", false],
    ["weba", false],
  ])("knows whether the %s client is a phone", async (client, expected) => {
    expect((await telegram(launchOn(client))).isMobileDevice).toBe(expected);
  });

  describe("links", () => {
    it("opens links through Telegram, and t.me links inside it", async () => {
      const platform = await telegram();
      platform.openLink("https://bitcoindeepa.com");
      platform.openTelegramLink("https://t.me/BitcoinDeepaBot");
      expect(sdk.openLink).toHaveBeenCalledExactlyOnceWith("https://bitcoindeepa.com");
      expect(sdk.openTelegramLink).toHaveBeenCalledExactlyOnceWith("https://t.me/BitcoinDeepaBot");
    });

    it("falls back to a new tab on a client that can't", async () => {
      sdk.openLink.mockImplementation(unsupported);
      sdk.openTelegramLink.mockImplementation(unsupported);
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const platform = await telegram();
      platform.openLink("https://bitcoindeepa.com");
      platform.openTelegramLink("https://t.me/BitcoinDeepaBot");
      expect(open.mock.calls).toEqual([
        ["https://bitcoindeepa.com", "_blank", "noopener,noreferrer"],
        ["https://t.me/BitcoinDeepaBot", "_blank", "noopener,noreferrer"],
      ]);
    });
  });

  describe("sharing", () => {
    it("shares a story with its link", async () => {
      const platform = await telegram();
      const widget_link = { url: "https://t.me/BitcoinDeepaBot", name: "Join" };
      platform.shareStory("https://example.com/story.mp4", { text: "Stacking sats", widget_link });
      expect(sdk.shareStory).toHaveBeenCalledExactlyOnceWith("https://example.com/story.mp4", {
        text: "Stacking sats",
        widgetLink: widget_link,
      });
    });

    it("does nothing on a client without stories", async () => {
      sdk.shareStory.mockImplementation(unsupported);
      const platform = await telegram();
      expect(() =>
        platform.shareStory("https://example.com/story.mp4", {
          text: "Stacking sats",
          widget_link: { url: "https://t.me/BitcoinDeepaBot", name: "Join" },
        })
      ).not.toThrow();
    });

    it("shares a link through Telegram's share sheet", async () => {
      const platform = await telegram();
      await expect(
        platform.share({ url: "https://app.bitcoindeepa.com", text: "Stack sats with me" })
      ).resolves.toBe("shared");
      expect(sdk.shareURL).toHaveBeenCalledExactlyOnceWith(
        "https://app.bitcoindeepa.com",
        "Stack sats with me"
      );
    });

    it("copies the link on a client without the share sheet", async () => {
      sdk.shareURL.mockImplementation(unsupported);
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      vi.stubGlobal("isSecureContext", true);
      const platform = await telegram();

      await expect(
        platform.share({ url: "https://app.bitcoindeepa.com", text: "Stack sats with me" })
      ).resolves.toBe("copied");
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        "Stack sats with me\nhttps://app.bitcoindeepa.com"
      );
      delete (navigator as { clipboard?: unknown }).clipboard;
    });
  });

  describe("confirm", () => {
    const QUESTION = {
      title: "Cancel your plan?",
      message: "You keep the sats you have.",
      confirmText: "Cancel plan",
    };

    it("asks with Telegram's own popup", async () => {
      sdk.popup.show.mockResolvedValue("confirm");
      const platform = await telegram();
      await expect(platform.confirm(QUESTION)).resolves.toBe(true);
      expect(sdk.popup.show).toHaveBeenCalledExactlyOnceWith({
        title: "Cancel your plan?",
        message: "You keep the sats you have.",
        buttons: [
          { id: "confirm", type: "default", text: "Cancel plan" },
          { id: "cancel", type: "cancel" },
        ],
      });
    });

    it.each(["cancel", null, undefined])("counts %s as no", async (button) => {
      sdk.popup.show.mockResolvedValue(button);
      const platform = await telegram();
      await expect(platform.confirm(QUESTION)).resolves.toBe(false);
    });

    it("marks a destructive action, and names the other button when asked to", async () => {
      sdk.popup.show.mockResolvedValue("cancel");
      const platform = await telegram();
      await platform.confirm({ ...QUESTION, destructive: true, cancelText: "Keep plan" });
      expect(sdk.popup.show.mock.calls[0][0].buttons).toEqual([
        { id: "confirm", type: "destructive", text: "Cancel plan" },
        { id: "cancel", type: "default", text: "Keep plan" },
      ]);
    });

    it("falls back to the app's own sheet on a client without popups", async () => {
      sdk.popup.show.mockRejectedValue(new Error("Method is unsupported"));
      const platform = await telegram();
      // the sheet registers with the same copy of the module the platform uses
      const { onConfirmRequest } = await import("@/platform/confirm");
      const stop = onConfirmRequest((request) => request.resolve(true));

      await expect(platform.confirm(QUESTION)).resolves.toBe(true);
      stop();
    });
  });

  describe("requestWriteAccess", () => {
    it.each([
      ["allowed", true],
      ["denied", false],
    ])("is %s -> %s", async (answer, expected) => {
      sdk.requestWriteAccess.mockResolvedValue(answer);
      const platform = await telegram();
      await expect(platform.requestWriteAccess()).resolves.toBe(expected);
    });

    it("is false on a client that can't ask", async () => {
      sdk.requestWriteAccess.mockRejectedValue(new Error("Method is unsupported"));
      const platform = await telegram();
      await expect(platform.requestWriteAccess()).resolves.toBe(false);
    });
  });

  describe("chrome", () => {
    it("paints the page's theme-color and Telegram's header, background and bottom bar", async () => {
      document.head.innerHTML = "";
      const platform = await telegram();
      platform.setChromeColor("#0b0b0f");
      expect(
        document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
      ).toBe("#0b0b0f");
      expect(sdk.postEvent.mock.calls).toEqual([
        ["web_app_set_header_color", { color: "#0b0b0f" }],
        ["web_app_set_background_color", { color: "#0b0b0f" }],
        ["web_app_set_bottom_bar_color", { color: "#0b0b0f" }],
      ]);
    });

    it("still paints the newer parts when an older client refuses one", async () => {
      sdk.postEvent.mockImplementation((event: string) => {
        if (event === "web_app_set_header_color") unsupported();
      });
      const platform = await telegram();
      expect(() => platform.setChromeColor("#0b0b0f")).not.toThrow();
      expect(sdk.postEvent).toHaveBeenCalledTimes(3);
    });

    it("closes the Mini App", async () => {
      const platform = await telegram();
      platform.close();
      expect(sdk.postEvent).toHaveBeenCalledExactlyOnceWith("web_app_close");

      sdk.postEvent.mockImplementation(unsupported);
      expect(() => platform.close()).not.toThrow();
    });
  });

  describe("light and dark", () => {
    it("takes the colour scheme from the background Telegram opened it with", async () => {
      expect((await telegram(launchOn("ios", "#ffffff"))).getColorScheme()).toBe("light");
      expect((await telegram(launchOn("ios", "#17212b"))).getColorScheme()).toBe("dark");
      expect((await telegram(launchOn("ios"))).getColorScheme()).toBeNull();
    });

    it("follows theme changes, and only calls back when the scheme really changes", async () => {
      const off = vi.fn();
      sdk.on.mockReturnValue(off);
      const platform = await telegram(launchOn("ios", "#ffffff"));
      const onChange = vi.fn();

      expect(platform.onColorSchemeChange(onChange)).toBe(off);
      expect(sdk.on).toHaveBeenCalledExactlyOnceWith("theme_changed", expect.any(Function));
      const themeChanged = sdk.on.mock.calls[0][1] as (event: {
        theme_params: { bg_color?: string };
      }) => void;

      // another light theme: nothing to do
      themeChanged({ theme_params: { bg_color: "#f5f5f5" } });
      expect(onChange).not.toHaveBeenCalled();

      themeChanged({ theme_params: { bg_color: "#17212b" } });
      expect(onChange).toHaveBeenCalledExactlyOnceWith("dark");
      expect(platform.getColorScheme()).toBe("dark");

      // an event with no background colour keeps the current scheme
      themeChanged({ theme_params: {} });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(platform.getColorScheme()).toBe("dark");
    });
  });
});
