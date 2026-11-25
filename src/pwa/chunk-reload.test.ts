// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

const reload = vi.fn();
/** What the module registered on window, to call directly */
let listeners: { type: string; listener: Listener; capture: unknown }[];

/** A fresh copy of the module with its listeners captured, as on a page load */
async function start() {
  vi.resetModules();
  const { reloadOnChunkLoadError } = await import("@/pwa/chunk-reload");
  reloadOnChunkLoadError();
  return reloadOnChunkLoadError;
}

const rejected = (reason: unknown) =>
  listeners.find((l) => l.type === "unhandledrejection")?.listener({ reason });

const failedToLoad = (target: unknown) =>
  listeners.find((l) => l.type === "error")?.listener({ target });

const script = (src: string) => ({ tagName: "SCRIPT", src });

beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  listeners = [];
  vi.stubGlobal("location", { reload });
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: Listener,
    capture?: unknown
  ) => {
    listeners.push({ type, listener, capture });
  }) as typeof window.addEventListener);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T04:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reloadOnChunkLoadError", () => {
  it("listens once, however often it's called", async () => {
    const reloadOnChunkLoadError = await start();
    reloadOnChunkLoadError();
    expect(listeners.map((l) => l.type)).toEqual(["unhandledrejection", "error"]);
  });

  it("listens for script errors in the capture phase, as they don't bubble", async () => {
    await start();
    expect(listeners.find((l) => l.type === "error")?.capture).toBe(true);
  });

  it.each([
    [{ name: "ChunkLoadError", message: "Loading chunk 123 failed." }],
    [{ name: "Error", message: "Loading chunk app-pages-internals failed" }],
    [{ name: "TypeError", message: "Failed to fetch dynamically imported module: /_next/a.js" }],
    [{ name: "TypeError", message: "Importing a module script failed." }],
  ])("reloads when a chunk can't be loaded: %j", async (reason) => {
    await start();
    rejected(reason);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ name: "TypeError", message: "Failed to fetch" }],
    [{ name: "FetchyError", message: "Request failed with status 500" }],
    ["a string"],
    [undefined],
    [null],
  ])("doesn't reload for another failed promise: %j", async (reason) => {
    await start();
    rejected(reason);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when one of the app's scripts fails to load", async () => {
    await start();
    failedToLoad(script("https://app.bitcoindeepa.com/_next/static/chunks/42.js"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["someone else's script", script("https://www.googletagmanager.com/gtag/js")],
    ["an image", { tagName: "IMG", src: "https://app.bitcoindeepa.com/_next/static/a.png" }],
    ["an error with no element", null],
  ])("doesn't reload for %s", async (_what, target) => {
    await start();
    failedToLoad(target);
    expect(reload).not.toHaveBeenCalled();
  });

  it("doesn't reload twice within 10 seconds, so a missing chunk can't loop", async () => {
    await start();
    rejected({ name: "ChunkLoadError" });
    vi.advanceTimersByTime(9_999);
    rejected({ name: "ChunkLoadError" });
    failedToLoad(script("/_next/static/chunks/42.js"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("holds that limit across the reload itself", async () => {
    await start();
    rejected({ name: "ChunkLoadError" });
    // the reloaded page starts the module again
    vi.advanceTimersByTime(2_000);
    listeners = [];
    await start();
    rejected({ name: "ChunkLoadError" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again after 10 seconds", async () => {
    await start();
    rejected({ name: "ChunkLoadError" });
    vi.advanceTimersByTime(10_000);
    rejected({ name: "ChunkLoadError" });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("still reloads when storage is blocked", async () => {
    await start();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    rejected({ name: "ChunkLoadError" });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
