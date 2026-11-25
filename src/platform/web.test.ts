// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebPlatform, setThemeColorMeta } from "@/platform/web";
import { onConfirmRequest } from "@/platform/confirm";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0";

function browser(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
}

/** Defines (or removes) a navigator feature jsdom doesn't have, for one test */
function navigatorHas(name: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

const themeColors = () =>
  [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => ({
    content: meta.content,
    media: meta.getAttribute("media"),
  }));

beforeEach(() => {
  document.head.innerHTML = "";
});

afterEach(() => {
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
  delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
});

describe("createWebPlatform", () => {
  it("is the web, with no Telegram launch data or stories", () => {
    const platform = createWebPlatform();
    expect(platform.kind).toBe("web");
    expect(platform.launch).toBeNull();
    expect(platform.capabilities.stories).toBe(false);
    expect(platform.getColorScheme()).toBeNull();
    expect(platform.onColorSchemeChange(() => {})).toBeNull();
    expect(() => platform.close()).not.toThrow();
  });

  it("stands in, with no kind, while detection is still running", () => {
    expect(createWebPlatform(null).kind).toBeNull();
  });

  it.each([
    ["an iPhone", IPHONE, 5, true],
    ["an Android phone", ANDROID, 5, true],
    // iPadOS reports itself as a Mac: touch points tell it apart
    ["an iPad", MAC, 5, true],
    ["a Mac", MAC, 0, false],
    ["a Windows PC", WINDOWS, 0, false],
  ])("knows whether %s is a phone or tablet", (_device, userAgent, touchPoints, expected) => {
    browser(userAgent, touchPoints);
    expect(createWebPlatform().isMobileDevice).toBe(expected);
  });

  it("opens links, t.me ones too, in a new tab that can't reach back into the app", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const platform = createWebPlatform();
    platform.openLink("https://bitcoindeepa.com");
    platform.openTelegramLink("https://t.me/BitcoinDeepaBot");
    expect(open.mock.calls).toEqual([
      ["https://bitcoindeepa.com", "_blank", "noopener,noreferrer"],
      ["https://t.me/BitcoinDeepaBot", "_blank", "noopener,noreferrer"],
    ]);
  });

  it("can't share a story", () => {
    expect(() =>
      createWebPlatform().shareStory("https://example.com/story.mp4", {
        text: "Stacking sats",
        widget_link: { url: "https://t.me/BitcoinDeepaBot", name: "Join" },
      })
    ).toThrow("Story sharing is only available inside Telegram");
  });

  it("says the bot can't be given write access here: the web login asks for it", async () => {
    await expect(createWebPlatform().requestWriteAccess()).resolves.toBe(false);
  });
});

describe("share", () => {
  const LINK = { url: "https://app.bitcoindeepa.com/?ref=FRIEND7", text: "Stack sats with me" };

  it("uses the device's share sheet", async () => {
    const share = vi.fn(async () => {});
    navigatorHas("share", share);
    await expect(createWebPlatform().share(LINK)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledExactlyOnceWith(LINK);
  });

  it("reports a share sheet the user closed, without copying anything", async () => {
    const writeText = vi.fn(async () => {});
    navigatorHas("clipboard", { writeText });
    navigatorHas(
      "share",
      vi.fn(async () => {
        throw new DOMException("Share canceled", "AbortError");
      })
    );
    await expect(createWebPlatform().share(LINK)).resolves.toBe("dismissed");
    expect(writeText).not.toHaveBeenCalled();
  });

  describe("copies the link instead", () => {
    const writeText = vi.fn(async () => {});

    beforeEach(() => {
      writeText.mockClear();
      navigatorHas("clipboard", { writeText });
      vi.stubGlobal("isSecureContext", true);
    });

    it("when there is no share sheet", async () => {
      await expect(createWebPlatform().share(LINK)).resolves.toBe("copied");
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        "Stack sats with me\nhttps://app.bitcoindeepa.com/?ref=FRIEND7"
      );
    });

    it("when the share sheet fails for another reason", async () => {
      navigatorHas(
        "share",
        vi.fn(async () => {
          throw new DOMException("Not allowed here", "NotAllowedError");
        })
      );
      await expect(createWebPlatform().share(LINK)).resolves.toBe("copied");
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it("as just the link when there is no text", async () => {
      await createWebPlatform().share({ url: LINK.url });
      expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK.url);
    });
  });
});

describe("confirm", () => {
  it("asks through the app's own sheet, not the browser's confirm box", async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    const stop = onConfirmRequest((request) =>
      request.resolve(request.confirmText === "Cancel plan")
    );

    await expect(
      createWebPlatform().confirm({
        title: "Cancel your plan?",
        message: "You keep the sats you have.",
        confirmText: "Cancel plan",
      })
    ).resolves.toBe(true);
    expect(nativeConfirm).not.toHaveBeenCalled();
    stop();
  });
});

describe("setThemeColorMeta", () => {
  it("adds the theme-color tag when the page has none", () => {
    setThemeColorMeta("#0b0b0f");
    expect(themeColors()).toEqual([{ content: "#0b0b0f", media: null }]);
  });

  it("points the page's light and dark tags at the colour, without removing them", () => {
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">`;
    const before = [...document.head.querySelectorAll("meta")];

    createWebPlatform().setChromeColor("#0b0b0f");

    // the same nodes (React owns them), now both showing the app's own colour
    expect([...document.head.querySelectorAll("meta")]).toEqual(before);
    expect(themeColors()).toEqual([
      { content: "#0b0b0f", media: null },
      { content: "#0b0b0f", media: null },
    ]);
  });
});
