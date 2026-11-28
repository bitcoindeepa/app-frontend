import { API_BASE_URL } from "@/lib/constants";
import { markLoginStarted } from "@/lib/app-lock";

/**
 * Client-side view of the backend session (BitcoinDeepa-DCA-BE user_session).
 *
 * - Web: the session is the backend's HttpOnly cookie, set by its
 *   "Log In with Telegram" redirect (/auth/telegram/start) and sent with
 *   credentials on our requests. JS never sees a token; GET /auth/me says
 *   whether we're signed in.
 * - Mini App: initData is exchanged once at launch (POST
 *   /auth/telegram/miniapp) for a session token, kept in memory and
 *   sessionStorage (never localStorage or a URL) and sent as a Bearer header.
 *
 * Telegram credentials are never stored here: after login the backend's own
 * session names the user, also to the bot.
 */

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";
export type SessionKind = "web" | "miniapp";

export interface SessionUser {
  id: string;
  /** The member's Bitcoin Deepa @username, when they have one */
  username?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  kind: SessionKind | null;
  user: SessionUser | null;
}

/** POST /auth/telegram/miniapp */
export interface MiniAppLoginResponse {
  token: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  user: { telegram_id: string };
  isRegistered: boolean;
  /** The bot linked the wallet at this login (false: bot unreachable) */
  walletLinked: boolean;
  /** New wallets only: false = the bot can't message the user yet */
  canMessage: boolean | null;
}

const MINIAPP_SESSION_KEY = "bitcoin-deepa-session";
/** Pre-session builds kept a 7-day JWT here: removed on load, never read */
const LEGACY_TOKEN_KEY = "bitcoin-deepa-auth-token";
const EXISTING_USER_KEY = "bitcoin-deepa-is-existing-user";

// Fired on the window whenever the session changes (login, logout, a 401).
export const AUTH_CHANGE_EVENT = "bitcoin-deepa-auth-change";

const LOADING: SessionSnapshot = { status: "loading", kind: null, user: null };
const SIGNED_OUT: SessionSnapshot = { status: "unauthenticated", kind: null, user: null };

let snapshot: SessionSnapshot = LOADING;
let miniAppToken: string | null = null;
/**
 * The backend itself said this browser has no web session (GET /auth/me or
 * another call answered 401, or logout was confirmed), as opposed to "still
 * checking" or "couldn't reach it". Only then can a login that starts here
 * be told apart from the session the browser already had (startWebLogin).
 */
let webSignedOutConfirmed = false;
let webProbe: Promise<SessionSnapshot> | null = null;
/** Numbers each probe: only the newest one may update the session */
let webProbeSeq = 0;

/** Who a snapshot is signed in as (null: nobody; undefined: still loading) */
function identityOf(s: SessionSnapshot): string | null | undefined {
  if (s.status === "loading") return undefined;
  return s.status === "authenticated" && s.user ? `${s.kind}:${s.user.id}` : null;
}

const identityListeners = new Set<() => void>();

/**
 * Runs synchronously whenever the signed-in account changes (signed out,
 * signed in, or another account), before anything renders with the new
 * session: the query client drops the previous account's cached data here
 * (providers.tsx), so it never reaches the next one.
 */
export function onIdentityChange(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

function emit(next: SessionSnapshot) {
  const before = identityOf(snapshot);
  const after = identityOf(next);
  snapshot = next;
  // Loading → first answer isn't a change: nothing was cached for anyone yet
  if (before !== undefined && before !== after) identityListeners.forEach((notify) => notify());
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

// On load: drop the legacy token, and pick up a Mini App session from this
// tab (sessionStorage survives a reload, not a reopen).
if (typeof window !== "undefined") {
  safeStorage("local")?.removeItem(LEGACY_TOKEN_KEY);
  try {
    const raw = safeStorage("session")?.getItem(MINIAPP_SESSION_KEY);
    const saved = raw ? (JSON.parse(raw) as { token?: unknown; user?: SessionUser }) : null;
    if (saved && typeof saved.token === "string" && saved.user?.id) {
      miniAppToken = saved.token;
      snapshot = { status: "authenticated", kind: "miniapp", user: saved.user };
    }
  } catch {
    // Corrupt entry: sign in again from initData
  }
}

export const getSessionSnapshot = (): SessionSnapshot => snapshot;
export const getServerSessionSnapshot = (): SessionSnapshot => LOADING;

export function subscribeSession(onChange: () => void): () => void {
  window.addEventListener(AUTH_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, onChange);
}

/** The Mini App's Bearer token (null on the web: the cookie is the session) */
export const getMiniAppToken = (): string | null => miniAppToken;

/**
 * Once the platform is known, settle "loading": the web asks the backend
 * (GET /auth/me, cookie); the Mini App without a saved session is signed
 * out until useRegisterUser exchanges its initData.
 */
export function resolveSession(platform: "telegram" | "web"): void {
  if (snapshot.status !== "loading") return;
  if (platform === "telegram") {
    emit(SIGNED_OUT);
    return;
  }
  void refreshWebSession();
}

/**
 * GET /auth/me with the cookie; resolves to the session it found. Calls made
 * while one is running share it, unless `fresh`: a probe sent before a login
 * set the cookie can't see that login, so a caller that just signed in asks
 * again. Only the newest probe updates the session, so a slower, older one
 * can't sign the member out after a newer one signed them in.
 */
export function refreshWebSession({ fresh = false } = {}): Promise<SessionSnapshot> {
  if (webProbe && !fresh) return webProbe;
  const seq = ++webProbeSeq;
  const probe = (async (): Promise<SessionSnapshot> => {
    let next: SessionSnapshot = SIGNED_OUT;
    let confirmed = false;
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        cache: "no-store",
        credentials: "include",
      });
      confirmed = response.status === 401;
      if (response.ok) {
        const body = (await response.json()) as {
          user?: { telegram_id?: string; username?: string | null };
        };
        const id = body.user?.telegram_id;
        if (id) {
          next = {
            status: "authenticated",
            kind: "web",
            user: { id, username: body.user?.username ?? undefined },
          };
        }
      }
    } catch {
      // Network error: signed out, as before
    }
    if (seq === webProbeSeq) {
      webSignedOutConfirmed = confirmed;
      emit(next);
    }
    return next;
  })();
  webProbe = probe;
  void probe.finally(() => {
    if (webProbe === probe) webProbe = null;
  });
  return probe;
}

/** Mini App: exchange the raw launch initData (never initDataUnsafe) for a session */
export async function loginWithMiniAppInitData(
  initData: string,
  referralCode?: string
): Promise<MiniAppLoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/telegram/miniapp`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(referralCode ? { initData, referral_code: referralCode } : { initData }),
  });
  const result = (await response.json().catch(() => ({}))) as Partial<MiniAppLoginResponse> & {
    message?: string;
  };
  if (!response.ok || !result.token || !result.user?.telegram_id) {
    throw new MiniAppLoginError(response.status, result.message);
  }
  const user = { id: result.user.telegram_id };
  miniAppToken = result.token;
  try {
    safeStorage("session")?.setItem(
      MINIAPP_SESSION_KEY,
      JSON.stringify({ token: result.token, user })
    );
  } catch {
    // Private mode: the session lasts until the tab closes
  }
  markIsExistingUserInStorage();
  emit({ status: "authenticated", kind: "miniapp", user });
  return result as MiniAppLoginResponse;
}

export class MiniAppLoginError extends Error {
  constructor(
    public status: number,
    message?: string
  ) {
    super(message || `Mini App login failed (${status})`);
    this.name = "MiniAppLoginError";
  }
  /** The backend refused the initData itself (too old / invalid): retrying can't help */
  get rejected(): boolean {
    return this.status === 401 || this.status === 400;
  }
}

/** Forget the session locally (after a 401, or logout) */
export function clearSession(): void {
  miniAppToken = null;
  safeStorage("session")?.removeItem(MINIAPP_SESSION_KEY);
  emit(SIGNED_OUT);
}

/**
 * A 401 for a request that carried `sentToken` (null = the web cookie).
 * Only ends the session that request used: a new one may have started while
 * it was in flight.
 */
export function onUnauthorized(sentToken: string | null): void {
  if (snapshot.status !== "authenticated") return;
  if (sentToken !== miniAppToken) return;
  // The web cookie was refused: the backend says this browser is signed out
  if (sentToken === null) webSignedOutConfirmed = true;
  clearSession();
}

/**
 * Revoke this session (or every session) on the backend, then forget it.
 * Throws when the backend didn't confirm it (offline, or e.g. 403 Invalid
 * origin): the HttpOnly cookie and the server session would still be alive,
 * so pretending we logged out would be wrong - the caller tells the user.
 * A 401 means the session was already gone.
 */
export async function logoutSession(all = false): Promise<void> {
  const token = miniAppToken;
  const response = await fetch(`${API_BASE_URL}/auth/${all ? "logout-all" : "logout"}`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(`Logout failed (${response.status})`);
  }
  if (!token) webSignedOutConfirmed = true;
  clearSession();
}

/**
 * Start "Log In with Telegram": a full-page redirect to Telegram and back.
 * The page it returns to doesn't ask for the passkey (lib/app-lock.ts), but
 * only when the backend had confirmed this browser was signed out: while
 * GET /auth/me is still loading or failed, the browser may still hold a
 * session, and a cancelled or failed login would then return to that old
 * session unlocked. Those logins return to the lock instead, as before.
 * ReloginPrompt (already signed in) also gets the lock, never the exemption.
 */
export function startWebLogin(returnTo?: string, referralCode?: string): void {
  if (webSignedOutConfirmed && snapshot.status === "unauthenticated") markLoginStarted();
  window.location.assign(webLoginUrl(returnTo, referralCode));
}

/** Where the web login starts (a full-page redirect to Telegram and back) */
export function webLoginUrl(returnTo?: string, referralCode?: string): string {
  const params = new URLSearchParams();
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    params.set("return_to", returnTo);
  }
  if (referralCode) params.set("ref", referralCode);
  const query = params.toString();
  return `${API_BASE_URL}/auth/telegram/start${query ? `?${query}` : ""}`;
}

/** The backend's ?login_error= codes, as user-facing text */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "cancelled":
      return "Login was cancelled. Try again when you're ready.";
    case "attempt_expired":
    case "bad_state":
      return "That login link expired. Please try again.";
    case "missing_telegram_id":
      return "Telegram didn't share your account ID. Please try again.";
    case "not_configured":
      return "Telegram login isn't available right now.";
    case "rate_limited":
      return "Too many attempts. Please wait a minute and try again.";
    default:
      return "Couldn't sign you in with Telegram. Please try again.";
  }
}

// ---- "Returning user" flag (UX only, not a credential) ----
// Read by LAUNCH_REDIRECT_SCRIPT to skip the landing page in the Mini App.

export const getIsExistingUserFromStorage = (): boolean =>
  safeStorage("local")?.getItem(EXISTING_USER_KEY) === "true";

export const markIsExistingUserInStorage = () => {
  try {
    safeStorage("local")?.setItem(EXISTING_USER_KEY, "true");
  } catch {
    // Storage full or refusing writes: only the launch shortcut is lost, the login must go on
  }
};

export const clearIsExistingUserInStorage = () => {
  safeStorage("local")?.removeItem(EXISTING_USER_KEY);
};
