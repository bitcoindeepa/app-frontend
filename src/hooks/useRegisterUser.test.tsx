// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import { INIT_DATA, telegramPlatform, webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { miniAppLogin, signInMiniApp, signOut } from "@/test/session";
import { getMiniAppToken, getSessionSnapshot, onUnauthorized } from "@/lib/auth";
import { useRegisterUser } from "@/hooks/useRegisterUser";
import { useSession } from "@/hooks/useSession";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

const MINUTE = 60_000;

/** The app's launch: the session settles (useSession) and the Mini App signs in */
const launch = () =>
  renderHookWithClient(() => {
    useRegisterUser();
    return useSession();
  });

/** Lets time pass, and whatever it triggers settle */
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  platform.current = telegramPlatform();
  // Real time keeps moving, so requests and waitFor still work
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRegisterUser", () => {
  it("signs the Mini App in from its launch initData as it opens", async () => {
    const logins = backend("POST", "/auth/telegram/miniapp", miniAppLogin());
    const { result } = launch();
    expect(result.current.status).toBe("unauthenticated");

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.kind).toBe("miniapp");
    expect(logins).toHaveLength(1);
    expect(logins[0].body).toEqual({ initData: INIT_DATA });
    expect(getMiniAppToken()).toBe("session-token");
  });

  it("reuses a session this tab already has (a reload)", async () => {
    await signInMiniApp();
    const logins = backend("POST", "/auth/telegram/miniapp", miniAppLogin());
    launch();
    await wait(2 * MINUTE);
    expect(logins).toHaveLength(0);
  });

  it("does nothing on the web, where there is no initData", async () => {
    signOut();
    platform.current = webPlatform();
    const logins = backend("POST", "/auth/telegram/miniapp", miniAppLogin());
    launch();
    await wait(2 * MINUTE);
    expect(logins).toHaveLength(0);
    expect(getSessionSnapshot().status).toBe("unauthenticated");
  });

  it("signs in again when the session ends, but not within a minute of the last try", async () => {
    signOut();
    const logins = backend("POST", "/auth/telegram/miniapp", () => miniAppLogin());
    const { result } = launch();
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(logins).toHaveLength(1);

    // The backend answers a request with 401: the session is over
    await wait(10_000);
    act(() => onUnauthorized("session-token"));
    expect(result.current.status).toBe("unauthenticated");

    await wait(49_000);
    expect(logins).toHaveLength(1);

    await wait(2_000);
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(logins).toHaveLength(2);
    expect(logins[1].body).toEqual({ initData: INIT_DATA });
  });

  it.each([401, 400])(
    "stops for good when the backend refuses the initData (%i)",
    async (status) => {
      signOut();
      const logins = backend(
        "POST",
        "/auth/telegram/miniapp",
        failWith(status, "initData is too old")
      );
      const { result } = launch();
      await waitFor(() => expect(logins).toHaveLength(1));

      await wait(5 * MINUTE);
      expect(logins).toHaveLength(1);
      expect(result.current.status).toBe("unauthenticated");
    }
  );

  it("tries again a minute later when the backend is failing, never in a loop", async () => {
    signOut();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let up = false;
    const logins = backend("POST", "/auth/telegram/miniapp", () =>
      up ? Response.json(miniAppLogin()) : Response.json({ message: "Down" }, { status: 503 })
    );
    const { result } = launch();
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(logins).toHaveLength(1);

    await wait(58_000);
    expect(logins).toHaveLength(1);

    up = true;
    await wait(3_000);
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(logins).toHaveLength(2);
  });
});
