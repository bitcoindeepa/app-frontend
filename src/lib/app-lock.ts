/**
 * Local half of the passkey lock (the backend's GET /passkey is the other
 * half). Web/PWA only: passkeys can't run inside Telegram's webview, so the
 * Mini App is never locked. The app locks itself:
 * - on every launch (a page load starts locked) and when it comes back after
 *   RELOCK_AFTER_MS in the background, if the member asks for the passkey
 *   when the app opens (GET /passkey `lock_on_open`, on by default)
 * - when the backend answers 403 passkey_required (fetchy calls
 *   passkeyRequired), e.g. the 12 h unlock ran out mid-session or a bank
 *   account change with the prompt on open turned off
 * Unlocking with a passkey (POST /passkey/unlock) unlocks both.
 *
 * Signing in doesn't ask for the passkey: the page a "Log In with Telegram"
 * redirect lands on starts unlocked (startWebLogin marks the login in
 * sessionStorage; this tab reads it once on load). startWebLogin marks it
 * only when the backend had confirmed this browser was signed out, so a
 * cancelled or failed login can't return to a session the browser already
 * had without the lock (a new session needs a login). The backend session stays
 * locked, so anything that needs the passkey (sends, sale payments, bank
 * accounts, passkey changes) still asks for it; the app locks again as usual
 * after RELOCK_AFTER_MS in the background or on the next launch.
 *
 * `bitcoin-deepa-passkey-on` (localStorage) only remembers that this device
 * should lock on launch (a passkey and the prompt on open), so the lock
 * screen shows at once instead of flashing balances while GET /passkey
 * loads. It's a UX hint: the backend still refuses money-moving calls from
 * a locked session.
 */

export const RELOCK_AFTER_MS = 60_000;
const HINT_KEY = "bitcoin-deepa-passkey-on";
const LOGIN_KEY = "bitcoin-deepa-login-started";
/** A login that started longer ago than this doesn't count (the backend's attempt lasts 10 min) */
const LOGIN_MAX_AGE_MS = 10 * 60_000;

/** "Log In with Telegram" is about to leave the page: the page it returns to starts unlocked */
export function markLoginStarted(): void {
  try {
    sessionStorage.setItem(LOGIN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the lock shows after the login, as before
  }
}

/** Whether this page load is the return from a login this tab started (read once) */
function takeLoginReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const started = Number(sessionStorage.getItem(LOGIN_KEY));
    sessionStorage.removeItem(LOGIN_KEY);
    return started > 0 && Date.now() - started < LOGIN_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
// Just signed in: no passkey prompt for this page load (see the top of this file)
let justLoggedIn = takeLoginReturn();
// Otherwise starts locked: opening the app asks for the passkey (when there is one)
let locked = !justLoggedIn;

const emit = () => listeners.forEach((notify) => notify());

export function subscribeAppLock(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Whether the app locked itself locally (see the top of this file) */
export const getAppLockSnapshot = (): boolean => locked;
export const getServerAppLockSnapshot = (): boolean => false;

/** Whether the app was opened by a login just now (no prompt until it relocks) */
export const getJustLoggedInSnapshot = (): boolean => justLoggedIn;

export function lockApp(): void {
  if (locked && !justLoggedIn) return;
  locked = true;
  justLoggedIn = false;
  emit();
}

// How many times the backend said this session must unlock (403
// passkey_required). useAppLock refetches GET /passkey on each: this tab's
// cached status may be stale (a passkey added from another session).
let required = 0;
export const getPasskeyRequiredSnapshot = (): number => required;

// The backend refused a call until this session unlocks: locks the app even
// when the member turned the prompt on open off
let unlockNeeded = false;
export const getUnlockNeededSnapshot = (): boolean => unlockNeeded;

/** The backend answered 403 passkey_required (fetchy) */
export function passkeyRequired(): void {
  required += 1;
  locked = true;
  unlockNeeded = true;
  emit();
}

export function unlockApp(): void {
  if (!locked && !unlockNeeded) return;
  locked = false;
  unlockNeeded = false;
  emit();
}

/**
 * Drop the launch lock without unlocking (the member turned the prompt on
 * open off). A pending 403 passkey_required still keeps the app locked.
 */
export function clearLaunchLock(): void {
  if (!locked || unlockNeeded) return;
  locked = false;
  emit();
}

/** Whether this status means "ask for the passkey when the app opens" */
export const locksOnOpen = (status: { enabled: boolean; lock_on_open?: boolean }): boolean =>
  // An older backend without the setting always asked
  status.enabled && status.lock_on_open !== false;

export function readPasskeyHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "true";
  } catch {
    return false;
  }
}

export function writePasskeyHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(HINT_KEY, "true");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage blocked: the lock still shows once GET /passkey answers
  }
}
