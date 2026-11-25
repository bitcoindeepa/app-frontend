import type { Platform, ShareInput, ShareResult } from "./types";
import { requestConfirm } from "./confirm";
import { copyText } from "@/lib/clipboard";
import { isAppleMobile } from "@/lib/device";

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  return /Android/i.test(navigator.userAgent) || isAppleMobile();
}

/**
 * Points the light/dark theme-color metas from layout.tsx at the page's
 * actual colour (the app's Appearance setting can differ from the OS). Those
 * tags belong to React/Next, so they're updated in place, never removed:
 * removing a node React owns breaks its next head update (removeChild).
 */
export function setThemeColorMeta(hex: string) {
  if (typeof document === "undefined") return;
  const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = hex;
    document.head.appendChild(meta);
    return;
  }
  metas.forEach((meta) => {
    meta.removeAttribute("media");
    meta.content = hex;
  });
}

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function shareOrCopy({ url, text }: ShareInput): Promise<ShareResult> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
      // Other failures (e.g. not allowed here) — fall back to copying.
    }
  }
  await copyText(text ? `${text}\n${url}` : url);
  return "copied";
}

/** Plain browser / installed PWA. Also used as the fallback while detection runs. */
export function createWebPlatform(kind: Platform["kind"] = "web"): Platform {
  return {
    kind,
    launch: null,
    isMobileDevice: isMobileBrowser(),
    capabilities: { stories: false },
    openLink: openInNewTab,
    openTelegramLink: openInNewTab,
    shareStory: () => {
      throw new Error("Story sharing is only available inside Telegram");
    },
    share: shareOrCopy,
    // In-app sheet rather than the browser's native confirm() box
    confirm: requestConfirm,
    // The web login already asks for it (data-request-access="write")
    requestWriteAccess: async () => false,
    setChromeColor: setThemeColorMeta,
    close: () => {},
    getColorScheme: () => null,
    onColorSchemeChange: () => null,
  };
}
