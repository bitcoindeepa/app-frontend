// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const MINUTE = 60_000;

const reload = vi.fn();
const update = vi.fn(async () => {});
const unregister = vi.fn();

/** The page the worker is registered from */
let page: { pathname: string; reload: typeof reload };
let visibility: DocumentVisibilityState;
let serviceWorker: {
  controller: object | null;
  addEventListener: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  getRegistrations: ReturnType<typeof vi.fn>;
};
let onVisibilityChange: (() => void) | undefined;

/**
 * Starts the module as a page load would.
 * - controller: a worker already controls the page (so a new one is an update)
 * - pageAgeMs: how long ago the page loaded
 */
async function start({
  mode = "production",
  controller = true,
  pageAgeMs = 5 * MINUTE,
  pathname = "/dashboard",
} = {}) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", mode);
  serviceWorker.controller = controller ? {} : null;
  page.pathname = pathname;
  vi.spyOn(performance, "now").mockReturnValue(pageAgeMs);
  const { registerServiceWorker } = await import("@/pwa/register-sw");
  registerServiceWorker();
  // let register() and the first update() settle
  await Promise.resolve();
  await Promise.resolve();
  return registerServiceWorker;
}

/** A new worker took control of the page */
function newWorkerTakesControl() {
  const call = serviceWorker.addEventListener.mock.calls.find(
    ([type]) => type === "controllerchange"
  );
  (call?.[1] as () => void)();
}

function comeBackToTheApp() {
  visibility = "visible";
  onVisibilityChange?.();
}

beforeEach(() => {
  reload.mockReset();
  update.mockClear();
  unregister.mockReset();
  onVisibilityChange = undefined;
  visibility = "visible";

  page = { pathname: "/dashboard", reload };
  vi.stubGlobal("location", page);

  serviceWorker = {
    controller: {},
    addEventListener: vi.fn(),
    register: vi.fn(async () => ({ update })),
    getRegistrations: vi.fn(async () => [{ unregister }, { unregister }]),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });

  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    listener: () => void
  ) => {
    if (type === "visibilitychange") onVisibilityChange = listener;
  }) as typeof document.addEventListener);
});

describe("registering", () => {
  it("registers /sw.js for the whole app and checks for an update", async () => {
    await start();
    expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("registers once, however often it's called", async () => {
    const registerServiceWorker = await start();
    registerServiceWorker();
    expect(serviceWorker.register).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without service workers", async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    await expect(start()).resolves.toBeTypeOf("function");
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it("survives a registration that fails", async () => {
    serviceWorker.register.mockRejectedValue(new Error("SSL certificate error"));
    await start();
    expect(() => comeBackToTheApp()).not.toThrow();
  });

  it.each(["development", "test"])(
    "in %s, registers nothing and removes workers left by a production run",
    async (mode) => {
      await start({ mode });
      expect(serviceWorker.register).not.toHaveBeenCalled();
      expect(unregister).toHaveBeenCalledTimes(2);
      expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
    }
  );
});

describe("reloading for an update", () => {
  it("reloads once when a new worker takes over an old page", async () => {
    await start();
    newWorkerTakesControl();
    newWorkerTakesControl();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("doesn't reload on the first install", async () => {
    await start({ controller: false });
    newWorkerTakesControl();
    expect(reload).not.toHaveBeenCalled();
  });

  it("doesn't reload a page that just loaded: it's already the new build", async () => {
    await start({ pageAgeMs: 59_000 });
    newWorkerTakesControl();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads a page that just loaded once the app has been away and back", async () => {
    await start({ pageAgeMs: 59_000 });
    comeBackToTheApp();
    newWorkerTakesControl();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("never reloading mid-task", () => {
  it.each([
    "/plans/choose",
    "/dashboard/plans",
    "/dashboard/plans/choose",
    "/verification",
    "/verification/details",
    "/payment/success",
    "/payment/cancel",
    "/dashboard/profile",
    "/dashboard/sell",
    "/dashboard/sell/ord_1",
    "/dashboard/buy",
  ])("doesn't reload on %s", async (pathname) => {
    await start({ pathname });
    newWorkerTakesControl();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(["/", "/dashboard", "/dashboard/activity", "/dashboard/news", "/dashboard/send"])(
    "reloads on %s",
    async (pathname) => {
      await start({ pathname });
      newWorkerTakesControl();
      expect(reload).toHaveBeenCalledTimes(1);
    }
  );

  it("reloads later, when the user comes back to the app somewhere else", async () => {
    await start({ pathname: "/dashboard/sell" });
    newWorkerTakesControl();

    // still selling: keep waiting
    comeBackToTheApp();
    expect(reload).not.toHaveBeenCalled();

    page.pathname = "/dashboard";
    comeBackToTheApp();
    expect(reload).toHaveBeenCalledTimes(1);

    comeBackToTheApp();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("checking for updates", () => {
  it("checks whenever the app comes back to the foreground", async () => {
    await start();
    update.mockClear();
    comeBackToTheApp();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("doesn't check, or reload, when the app goes to the background", async () => {
    await start({ pathname: "/dashboard/sell" });
    newWorkerTakesControl();
    update.mockClear();

    page.pathname = "/dashboard";
    visibility = "hidden";
    onVisibilityChange?.();
    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
