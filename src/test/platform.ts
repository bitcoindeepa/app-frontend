import { vi } from "vitest";
import type { Platform, TelegramLaunch } from "@/platform/types";

/**
 * A stand-in for what usePlatform() returns, so a hook or component can be
 * tested as the browser/PWA and as the Telegram Mini App. Every method is a
 * spy. Use it with a mock of "@/platform":
 *
 *   const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
 *   vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
 *   beforeEach(() => { platform.current = webPlatform(); });
 */
function fakePlatform(kind: Platform["kind"], launch: TelegramLaunch | null): Platform {
  return {
    kind,
    launch,
    isMobileDevice: false,
    capabilities: { stories: kind === "telegram" },
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    shareStory: vi.fn(),
    share: vi.fn(async () => "shared" as const),
    confirm: vi.fn(async () => true),
    requestWriteAccess: vi.fn(async () => kind === "telegram"),
    setChromeColor: vi.fn(),
    close: vi.fn(),
    getColorScheme: vi.fn(() => null),
    onColorSchemeChange: vi.fn(() => null),
  };
}

/** A browser or installed PWA */
export const webPlatform = (over: Partial<Platform> = {}): Platform => ({
  ...fakePlatform("web", null),
  ...over,
});

/** The raw initData Telegram opened the Mini App with */
export const INIT_DATA = "query_id=AAF1&user=%7B%22id%22%3A777%7D&auth_date=1795667400&hash=abc";

/** The Telegram Mini App, opened with launch data */
export const telegramPlatform = (over: Partial<Platform> = {}): Platform => ({
  ...fakePlatform("telegram", {
    initDataRaw: INIT_DATA,
    initData: { user: { id: 777 } },
    user: { id: 777 },
    clientPlatform: "android",
    raw: {},
  }),
  ...over,
});

/** Before detection has finished: neither web nor Telegram yet */
export const pendingPlatform = (): Platform => fakePlatform(null, null);

/**
 * For screens, which also use the haptics and the back button: a whole
 * stand-in for the "@/platform" module, around one platform that tests set.
 *
 *   vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
 *   beforeEach(() => setPlatform(webPlatform()));
 */
const active = { platform: null as Platform | null };

/** The platform the screen under test runs on. Returns it, to assert on its spies. */
export function setPlatform(platform: Platform): Platform {
  active.platform = platform;
  return platform;
}

export function platformModule() {
  return {
    usePlatform: () => {
      if (!active.platform) throw new Error("Call setPlatform(...) before rendering");
      return active.platform;
    },
    haptic: { impact: vi.fn(), notify: vi.fn(), select: vi.fn() },
    useBackButton: vi.fn(),
    HapticsLayer: () => null,
    PlatformProvider: ({ children }: { children: unknown }) => children,
  };
}
