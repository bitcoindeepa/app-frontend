import { describe, expect, it, vi } from "vitest";
import { EARLY_READY_SCRIPT, LAUNCH_REDIRECT_SCRIPT } from "@/lib/launch-redirect";

const LAUNCH_HASH = "#tgWebAppData=query_id%3D1%26hash%3Dabc&tgWebAppVersion=9.1";
const READY = JSON.stringify({ eventType: "web_app_ready", eventData: {} });

type FakeWindow = Record<string, unknown>;

/** Runs one of the inline scripts the way the page would, against stand-ins for the browser */
function run(
  script: string,
  page: {
    pathname?: string;
    search?: string;
    hash?: string;
    existingUser?: string | null;
    window?: FakeWindow;
  }
) {
  const location = {
    pathname: page.pathname ?? "/",
    search: page.search ?? "",
    hash: page.hash ?? "",
    replace: vi.fn(),
  };
  const localStorage = {
    getItem: vi.fn((key: string) =>
      key === "bitcoin-deepa-is-existing-user" ? (page.existingUser ?? null) : null
    ),
  };
  const window: FakeWindow = page.window ?? {};
  if (!("self" in window)) {
    window.self = window;
    window.top = window;
  }
  new Function("window", "location", "localStorage", script)(window, location, localStorage);
  return { location, window };
}

describe("LAUNCH_REDIRECT_SCRIPT", () => {
  it("sends a returning member opening the Mini App straight to the dashboard", () => {
    const { location, window } = run(LAUNCH_REDIRECT_SCRIPT, {
      hash: LAUNCH_HASH,
      existingUser: "true",
    });
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(`/dashboard${LAUNCH_HASH}`);
    expect(window.__launchRedirect).toBe(1);
  });

  it("keeps the query string and the launch params", () => {
    const { location } = run(LAUNCH_REDIRECT_SCRIPT, {
      search: "?ref=FRIEND7",
      hash: LAUNCH_HASH,
      existingUser: "true",
    });
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(
      `/dashboard?ref=FRIEND7${LAUNCH_HASH}`
    );
  });

  it.each([
    ["a new member", { hash: LAUNCH_HASH, existingUser: null }],
    ["a flag that isn't true", { hash: LAUNCH_HASH, existingUser: "false" }],
    ["a browser, with no Telegram launch data", { hash: "", existingUser: "true" }],
    ["another page", { pathname: "/verification", hash: LAUNCH_HASH, existingUser: "true" }],
    ["the dashboard itself", { pathname: "/dashboard", hash: LAUNCH_HASH, existingUser: "true" }],
  ])("leaves %s where they are", (_who, page) => {
    const { location, window } = run(LAUNCH_REDIRECT_SCRIPT, page);
    expect(location.replace).not.toHaveBeenCalled();
    expect(window.__launchRedirect).toBeUndefined();
  });

  it("only ever goes to /dashboard on this site", () => {
    const { location } = run(LAUNCH_REDIRECT_SCRIPT, {
      search: "?next=https://evil.example",
      hash: `${LAUNCH_HASH}&next=//evil.example`,
      existingUser: "true",
    });
    const target = location.replace.mock.calls[0][0] as string;
    expect(new URL(target, "https://app.bitcoindeepa.com").origin).toBe(
      "https://app.bitcoindeepa.com"
    );
    expect(new URL(target, "https://app.bitcoindeepa.com").pathname).toBe("/dashboard");
  });

  it("does nothing, without an error, when storage is blocked", () => {
    const location = { pathname: "/", search: "", hash: LAUNCH_HASH, replace: vi.fn() };
    const localStorage = {
      getItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(() =>
      new Function("window", "location", "localStorage", LAUNCH_REDIRECT_SCRIPT)(
        {},
        location,
        localStorage
      )
    ).not.toThrow();
    expect(location.replace).not.toHaveBeenCalled();
  });
});

describe("EARLY_READY_SCRIPT", () => {
  it("tells Telegram Web the page is ready, and only Telegram Web", () => {
    const postMessage = vi.fn();
    const window: FakeWindow = { parent: { postMessage } };
    window.self = window;
    window.top = {};
    run(EARLY_READY_SCRIPT, { hash: LAUNCH_HASH, window });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(READY, "https://web.telegram.org");
  });

  it("tells the Telegram mobile and desktop apps through their proxy", () => {
    const postEvent = vi.fn();
    run(EARLY_READY_SCRIPT, {
      hash: LAUNCH_HASH,
      window: { TelegramWebviewProxy: { postEvent } },
    });
    expect(postEvent).toHaveBeenCalledExactlyOnceWith("web_app_ready", "{}");
  });

  it("falls back to external.notify", () => {
    const notify = vi.fn();
    run(EARLY_READY_SCRIPT, { hash: LAUNCH_HASH, window: { external: { notify } } });
    expect(notify).toHaveBeenCalledExactlyOnceWith(READY);
  });

  it("prefers the proxy over external.notify", () => {
    const postEvent = vi.fn();
    const notify = vi.fn();
    run(EARLY_READY_SCRIPT, {
      hash: LAUNCH_HASH,
      window: { TelegramWebviewProxy: { postEvent }, external: { notify } },
    });
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("says nothing in a browser, with no Telegram launch data", () => {
    const postEvent = vi.fn();
    run(EARLY_READY_SCRIPT, { hash: "", window: { TelegramWebviewProxy: { postEvent } } });
    expect(postEvent).not.toHaveBeenCalled();
  });

  it("says nothing while the launch redirect is leaving for the dashboard", () => {
    const postEvent = vi.fn();
    run(EARLY_READY_SCRIPT, {
      hash: LAUNCH_HASH,
      window: { __launchRedirect: 1, TelegramWebviewProxy: { postEvent } },
    });
    expect(postEvent).not.toHaveBeenCalled();
  });

  it("does nothing, without an error, when no transport exists", () => {
    expect(() => run(EARLY_READY_SCRIPT, { hash: LAUNCH_HASH, window: {} })).not.toThrow();
  });
});
