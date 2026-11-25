// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const API = "https://api.test";
const SESSION_KEY = "bitcoin-deepa-session";
const LEGACY_TOKEN_KEY = "bitcoin-deepa-auth-token";
const EXISTING_USER_KEY = "bitcoin-deepa-is-existing-user";

const LOADING = { status: "loading", kind: null, user: null };
const SIGNED_OUT = { status: "unauthenticated", kind: null, user: null };

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

/** A fresh copy of the module, as on a page load: it reads storage as it loads */
async function loadAuth() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", API);
  return import("@/lib/auth");
}

const miniAppLogin = (over: Record<string, unknown> = {}) => ({
  token: "session-token",
  expiresAt: "2026-11-27T00:00:00Z",
  absoluteExpiresAt: "2026-12-26T00:00:00Z",
  user: { telegram_id: "777" },
  isRegistered: true,
  walletLinked: true,
  canMessage: null,
  ...over,
});

/** A module with a Mini App session signed in */
async function signedInMiniApp(token = "session-token") {
  const auth = await loadAuth();
  fetchMock.mockResolvedValueOnce(json(201, miniAppLogin({ token })));
  await auth.loginWithMiniAppInitData("query_id=1&hash=abc");
  fetchMock.mockClear();
  return auth;
}

/** A module with a web (cookie) session signed in */
async function signedInWeb() {
  const auth = await loadAuth();
  fetchMock.mockResolvedValueOnce(json(200, { user: { telegram_id: "777", username: "nimal" } }));
  await auth.refreshWebSession();
  fetchMock.mockClear();
  return auth;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("on load", () => {
  it("starts as loading, with no token", async () => {
    const auth = await loadAuth();
    expect(auth.getSessionSnapshot()).toEqual(LOADING);
    expect(auth.getServerSessionSnapshot()).toEqual(LOADING);
    expect(auth.getMiniAppToken()).toBeNull();
  });

  it("deletes the token older builds kept in localStorage", async () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, "old-jwt");
    const auth = await loadAuth();
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
    expect(auth.getMiniAppToken()).toBeNull();
    expect(auth.getSessionSnapshot()).toEqual(LOADING);
  });

  it("picks up this tab's Mini App session after a reload", async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "saved", user: { id: "777" } }));
    const auth = await loadAuth();
    expect(auth.getMiniAppToken()).toBe("saved");
    expect(auth.getSessionSnapshot()).toEqual({
      status: "authenticated",
      kind: "miniapp",
      user: { id: "777" },
    });
  });

  it.each([
    ["broken JSON", "{not json"],
    ["no user", JSON.stringify({ token: "saved" })],
    ["no token", JSON.stringify({ user: { id: "777" } })],
    ["a token that isn't text", JSON.stringify({ token: 42, user: { id: "777" } })],
  ])("ignores a saved session with %s", async (_what, saved) => {
    sessionStorage.setItem(SESSION_KEY, saved);
    const auth = await loadAuth();
    expect(auth.getMiniAppToken()).toBeNull();
    expect(auth.getSessionSnapshot()).toEqual(LOADING);
  });

  it("never reads a session from localStorage", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: "saved", user: { id: "777" } }));
    const auth = await loadAuth();
    expect(auth.getMiniAppToken()).toBeNull();
  });
});

describe("resolveSession", () => {
  it("in the Mini App, is signed out until initData is exchanged", async () => {
    const auth = await loadAuth();
    auth.resolveSession("telegram");
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on the web, asks the backend who is signed in", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(200, { user: { telegram_id: "777" } }));
    auth.resolveSession("web");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API}/auth/me`, {
      cache: "no-store",
      credentials: "include",
    });
    await vi.waitFor(() => expect(auth.getSessionSnapshot().status).toBe("authenticated"));
  });

  it("leaves a session that's already settled alone", async () => {
    const auth = await signedInMiniApp();
    auth.resolveSession("web");
    auth.resolveSession("telegram");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
  });
});

describe("refreshWebSession", () => {
  it("signs in from the cookie, and JS never holds a token", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(200, { user: { telegram_id: "777", username: "nimal" } }));
    const session = {
      status: "authenticated",
      kind: "web",
      user: { id: "777", username: "nimal" },
    };
    await expect(auth.refreshWebSession()).resolves.toEqual(session);
    expect(auth.getSessionSnapshot()).toEqual(session);
    expect(auth.getMiniAppToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("leaves the @username out when the member has none", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(200, { user: { telegram_id: "777", username: null } }));
    expect((await auth.refreshWebSession()).user).toEqual({ id: "777", username: undefined });
  });

  it.each([
    ["the backend says 401", () => Promise.resolve(json(401, { message: "Unauthorized" }))],
    ["the answer names no user", () => Promise.resolve(json(200, {}))],
    ["the network fails", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("is signed out when %s", async (_when, respond) => {
    const auth = await loadAuth();
    fetchMock.mockImplementation(respond);
    await expect(auth.refreshWebSession()).resolves.toEqual(SIGNED_OUT);
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
  });

  it("shares one request between calls made while it runs", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(200, { user: { telegram_id: "777" } }));
    const [a, b] = await Promise.all([auth.refreshWebSession(), auth.refreshWebSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("asks again once the last request has finished", async () => {
    const auth = await loadAuth();
    fetchMock.mockImplementation(async () => json(200, { user: { telegram_id: "777" } }));
    await auth.refreshWebSession();
    await vi.waitFor(async () => {
      fetchMock.mockClear();
      await auth.refreshWebSession();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("lets only the newest request decide: a slow, older one can't sign the member out", async () => {
    const auth = await loadAuth();
    // Sent before the login set the cookie: it will come back 401, late
    let answerOld!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answerOld = resolve)));
    const old = auth.refreshWebSession();

    // The login finished: ask again, and this one sees the cookie
    fetchMock.mockResolvedValueOnce(json(200, { user: { telegram_id: "777" } }));
    await auth.refreshWebSession({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.getSessionSnapshot().status).toBe("authenticated");

    answerOld(json(401));
    await expect(old).resolves.toEqual(SIGNED_OUT);
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
  });
});

describe("loginWithMiniAppInitData", () => {
  it("exchanges the raw initData for a session", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(201, miniAppLogin()));
    const result = await auth.loginWithMiniAppInitData("query_id=1&hash=abc");

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API}/auth/telegram/miniapp`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: "query_id=1&hash=abc" }),
    });
    expect(result.token).toBe("session-token");
    expect(auth.getMiniAppToken()).toBe("session-token");
    expect(auth.getSessionSnapshot()).toEqual({
      status: "authenticated",
      kind: "miniapp",
      user: { id: "777" },
    });
  });

  it("sends the referral code along when there is one", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(201, miniAppLogin()));
    await auth.loginWithMiniAppInitData("query_id=1&hash=abc", "FRIEND7");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ initData: "query_id=1&hash=abc", referral_code: "FRIEND7" })
    );
  });

  it("keeps the token in sessionStorage, never in localStorage", async () => {
    await signedInMiniApp("session-token");
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "")).toEqual({
      token: "session-token",
      user: { id: "777" },
    });
    const everythingInLocalStorage = JSON.stringify({ ...localStorage });
    expect(everythingInLocalStorage).not.toContain("session-token");
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("never stores the Telegram initData", async () => {
    await signedInMiniApp();
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain("query_id");
  });

  it("remembers that this is a returning member", async () => {
    const auth = await signedInMiniApp();
    expect(localStorage.getItem(EXISTING_USER_KEY)).toBe("true");
    expect(auth.getIsExistingUserFromStorage()).toBe(true);
  });

  it("still signs in when storage refuses to save", async () => {
    const auth = await loadAuth();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    fetchMock.mockResolvedValue(json(201, miniAppLogin()));
    await auth.loginWithMiniAppInitData("query_id=1&hash=abc");
    expect(auth.getMiniAppToken()).toBe("session-token");
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
  });

  it.each([
    [401, true],
    [400, true],
    [500, false],
    [503, false],
  ])("fails on a %i, and says whether retrying can help", async (status, rejected) => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(status, { message: "initData is too old" }));
    const error = await auth.loginWithMiniAppInitData("query_id=1&hash=abc").catch((e) => e);
    expect(error).toBeInstanceOf(auth.MiniAppLoginError);
    expect(error.status).toBe(status);
    expect(error.rejected).toBe(rejected);
    expect(error.message).toBe("initData is too old");
    expect(auth.getMiniAppToken()).toBeNull();
    expect(auth.getSessionSnapshot()).toEqual(LOADING);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("fails when the answer isn't JSON", async () => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(auth.loginWithMiniAppInitData("query_id=1")).rejects.toThrow(
      "Mini App login failed (502)"
    );
  });

  it.each([
    ["no token", miniAppLogin({ token: undefined })],
    ["no user", miniAppLogin({ user: undefined })],
  ])("fails on a 2xx answer with %s", async (_what, body) => {
    const auth = await loadAuth();
    fetchMock.mockResolvedValue(json(201, body));
    await expect(auth.loginWithMiniAppInitData("query_id=1")).rejects.toBeInstanceOf(
      auth.MiniAppLoginError
    );
    expect(auth.getMiniAppToken()).toBeNull();
  });
});

describe("clearSession", () => {
  it("forgets the token here and in storage", async () => {
    const auth = await signedInMiniApp();
    auth.clearSession();
    expect(auth.getMiniAppToken()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
  });
});

describe("onUnauthorized", () => {
  it("ends the Mini App session the request used", async () => {
    const auth = await signedInMiniApp("session-token");
    auth.onUnauthorized("session-token");
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
    expect(auth.getMiniAppToken()).toBeNull();
  });

  it("keeps a Mini App session that started after the request was sent", async () => {
    const auth = await signedInMiniApp("new-token");
    auth.onUnauthorized("old-token");
    auth.onUnauthorized(null);
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
    expect(auth.getMiniAppToken()).toBe("new-token");
  });

  it("ends the web session for a request that carried the cookie", async () => {
    const auth = await signedInWeb();
    auth.onUnauthorized(null);
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
  });

  it("keeps the web session for a request that carried an old token", async () => {
    const auth = await signedInWeb();
    auth.onUnauthorized("old-token");
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
  });

  it("does nothing while nobody is signed in", async () => {
    const auth = await loadAuth();
    const onChange = vi.fn();
    const unsubscribe = auth.subscribeSession(onChange);
    auth.onUnauthorized(null);
    expect(auth.getSessionSnapshot()).toEqual(LOADING);
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("logoutSession", () => {
  it("revokes the web session on the backend, then forgets it", async () => {
    const auth = await signedInWeb();
    fetchMock.mockResolvedValue(json(200));
    await auth.logoutSession();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API}/auth/logout`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {},
    });
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
  });

  it("sends the Mini App's token", async () => {
    const auth = await signedInMiniApp("session-token");
    fetchMock.mockResolvedValue(json(200));
    await auth.logoutSession();
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer session-token" });
    expect(auth.getMiniAppToken()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("can log out of all devices", async () => {
    const auth = await signedInWeb();
    fetchMock.mockResolvedValue(json(200));
    await auth.logoutSession(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/auth/logout-all`);
  });

  it("counts a 401 as logged out: the session was already gone", async () => {
    const auth = await signedInWeb();
    fetchMock.mockResolvedValue(json(401));
    await auth.logoutSession();
    expect(auth.getSessionSnapshot()).toEqual(SIGNED_OUT);
  });

  it.each([403, 500])("throws on a %i and stays signed in", async (status) => {
    const auth = await signedInMiniApp("session-token");
    fetchMock.mockResolvedValue(json(status));
    await expect(auth.logoutSession()).rejects.toThrow(`Logout failed (${status})`);
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
    expect(auth.getMiniAppToken()).toBe("session-token");
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("throws when offline and stays signed in", async () => {
    const auth = await signedInWeb();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(auth.logoutSession()).rejects.toThrow("Failed to fetch");
    expect(auth.getSessionSnapshot().status).toBe("authenticated");
  });
});

describe("session changes", () => {
  it("tells subscribers on login and on logout, until they unsubscribe", async () => {
    const auth = await loadAuth();
    const onChange = vi.fn();
    const unsubscribe = auth.subscribeSession(onChange);

    fetchMock.mockResolvedValueOnce(json(201, miniAppLogin()));
    await auth.loginWithMiniAppInitData("query_id=1");
    expect(onChange).toHaveBeenCalledTimes(1);

    auth.clearSession();
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    auth.clearSession();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("web login", () => {
  it("starts at the backend", async () => {
    const auth = await loadAuth();
    expect(auth.webLoginUrl()).toBe(`${API}/auth/telegram/start`);
  });

  it("asks to come back to a page of this app", async () => {
    const auth = await loadAuth();
    expect(auth.webLoginUrl("/dashboard/sell?x=1")).toBe(
      `${API}/auth/telegram/start?return_to=%2Fdashboard%2Fsell%3Fx%3D1`
    );
  });

  it.each(["https://evil.example", "//evil.example", "evil.example", "javascript:alert(1)"])(
    "doesn't ask to come back to %s",
    async (returnTo) => {
      const auth = await loadAuth();
      expect(auth.webLoginUrl(returnTo)).toBe(`${API}/auth/telegram/start`);
    }
  );

  it("passes the referral code on", async () => {
    const auth = await loadAuth();
    expect(auth.webLoginUrl(undefined, "FRIEND7")).toBe(`${API}/auth/telegram/start?ref=FRIEND7`);
    expect(auth.webLoginUrl("/dashboard", "FRIEND7")).toBe(
      `${API}/auth/telegram/start?return_to=%2Fdashboard&ref=FRIEND7`
    );
  });

  it("marks the login as started, then leaves for Telegram", async () => {
    const auth = await loadAuth();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    auth.startWebLogin("/dashboard");
    expect(Number(sessionStorage.getItem("bitcoin-deepa-login-started"))).toBeGreaterThan(0);
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      `${API}/auth/telegram/start?return_to=%2Fdashboard`
    );
  });

  it.each([
    [null, null],
    ["", null],
    ["cancelled", "Login was cancelled. Try again when you're ready."],
    ["attempt_expired", "That login link expired. Please try again."],
    ["bad_state", "That login link expired. Please try again."],
    ["missing_telegram_id", "Telegram didn't share your account ID. Please try again."],
    ["not_configured", "Telegram login isn't available right now."],
    ["rate_limited", "Too many attempts. Please wait a minute and try again."],
    ["<script>alert(1)</script>", "Couldn't sign you in with Telegram. Please try again."],
  ])("explains the login error %j", async (code, message) => {
    const auth = await loadAuth();
    expect(auth.loginErrorMessage(code)).toBe(message);
  });
});

describe("the returning-member flag", () => {
  it("is set, read and cleared in localStorage", async () => {
    const auth = await loadAuth();
    expect(auth.getIsExistingUserFromStorage()).toBe(false);
    auth.markIsExistingUserInStorage();
    expect(localStorage.getItem(EXISTING_USER_KEY)).toBe("true");
    expect(auth.getIsExistingUserFromStorage()).toBe(true);
    auth.clearIsExistingUserInStorage();
    expect(auth.getIsExistingUserFromStorage()).toBe(false);
  });
});
