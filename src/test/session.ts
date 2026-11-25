import { act } from "@testing-library/react";
import { clearSession, loginWithMiniAppInitData, refreshWebSession } from "@/lib/auth";
import { backend } from "@/test/server";
import { INIT_DATA } from "@/test/platform";

/**
 * Puts the real session store (lib/auth) in a known state through the fake
 * backend, the way the app gets there. The store lives for the whole test
 * file, so each test says which state it starts from.
 */

/** The answer of POST /auth/telegram/miniapp */
export const miniAppLogin = (over: Record<string, unknown> = {}) => ({
  token: "session-token",
  expiresAt: "2026-11-27T00:00:00Z",
  absoluteExpiresAt: "2026-12-26T00:00:00Z",
  user: { telegram_id: "777" },
  isRegistered: true,
  walletLinked: true,
  canMessage: null,
  ...over,
});

/** Signed in on the web: the backend's cookie names the member */
export async function signInWeb() {
  backend("GET", "/auth/me", { user: { telegram_id: "777", username: "nimal" } });
  await act(async () => {
    await refreshWebSession({ fresh: true });
  });
}

/** Signed in inside Telegram, holding a session token */
export async function signInMiniApp(token = "session-token") {
  backend("POST", "/auth/telegram/miniapp", miniAppLogin({ token }));
  await act(async () => {
    await loginWithMiniAppInitData(INIT_DATA);
  });
}

export function signOut() {
  act(() => clearSession());
}
