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
 * `bitcoin-deepa-passkey-on` (localStorage) only remembers that this device
 * should lock on launch (a passkey and the prompt on open), so the lock
 * screen shows at once instead of flashing balances while GET /passkey
 * loads. It's a UX hint: the backend still refuses money-moving calls from
 * a locked session.
 */

export const RELOCK_AFTER_MS = 60_000;
const HINT_KEY = "bitcoin-deepa-passkey-on";

const listeners = new Set<() => void>();
// Starts locked: opening the app asks for the passkey (when there is one)
let locked = true;

const emit = () => listeners.forEach((notify) => notify());

export function subscribeAppLock(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Whether the app locked itself locally (see the top of this file) */
export const getAppLockSnapshot = (): boolean => locked;
export const getServerAppLockSnapshot = (): boolean => false;

export function lockApp(): void {
  if (locked) return;
  locked = true;
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
