// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import type { PasskeyStatus } from "@/hooks/query/usePasskey";
import { setVisibility } from "@/test/dom";
import { webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, startBackend } from "@/test/server";
import { signInWeb } from "@/test/session";
import { getJustLoggedInSnapshot, passkeyRequired, unlockApp } from "@/lib/app-lock";
import { useAppLock } from "@/hooks/useAppLock";

// This file is the page a "Log In with Telegram" redirect came back to: the
// mark startWebLogin left is in sessionStorage before lib/app-lock loads.
vi.hoisted(() => sessionStorage.setItem("bitcoin-deepa-login-started", String(Date.now())));

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

// A member with a passkey, asked for it when the app opens. A Telegram login
// never unlocks the backend session.
const status: PasskeyStatus = {
  enabled: true,
  unlocked: false,
  available: true,
  lock_on_open: true,
  passkeys: [
    { id: "pk_1", name: "iPhone", created_at: "2026-11-01T00:00:00Z", last_used_at: null },
  ],
};

async function open() {
  platform.current = webPlatform();
  await signInWeb();
  backend("GET", "/passkey", () => status);
  const view = renderHookWithClient(() => useAppLock());
  await waitFor(() => expect(view.queryClient.getQueryData(["passkey"])).toBeDefined());
  return view;
}

// One story, in order: the module's state carries from each step to the next
describe("useAppLock, right after logging in", () => {
  it("doesn't ask for the passkey", async () => {
    expect(getJustLoggedInSnapshot()).toBe(true);
    const { result } = await open();
    expect(result.current).toBe(false);
  });

  it("locks when the backend answers 403 passkey_required, until the member unlocks", async () => {
    const { result } = await open();
    act(() => passkeyRequired());
    expect(result.current).toBe(true);

    act(() => unlockApp());
    expect(result.current).toBe(false);
  });

  it("locks as usual after 60 seconds in the background", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = await open();
    expect(result.current).toBe(false);

    setVisibility("hidden");
    vi.setSystemTime(Date.now() + 60_000);
    setVisibility("visible");

    expect(getJustLoggedInSnapshot()).toBe(false);
    expect(result.current).toBe(true);
    vi.useRealTimers();
  });
});
