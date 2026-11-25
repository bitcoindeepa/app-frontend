/**
 * Local half of the passkey lock (the backend's GET /passkey is the other
 * half). Web/PWA only: passkeys can't run inside Telegram's webview, so the
 * Mini App is never locked. The app locks itself:
 * - on every launch (a page load starts locked)
 * - when it comes back after RELOCK_AFTER_MS in the background
 * - when the backend answers 403 passkey_required (fetchy calls lockApp),
 *   e.g. the 12 h unlock ran out mid-session
 * Unlocking with a passkey (POST /passkey/unlock) unlocks both.
 *
 * `bitcoin-deepa-passkey-on` (localStorage) only remembers that this device's
 * member has a passkey, so the lock screen shows at once on launch instead
 * of flashing balances while GET /passkey loads. It's a UX hint: the backend
 * still refuses money-moving calls from a locked session.
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

export function unlockApp(): void {
  if (!locked) return;
  locked = false;
  emit();
}

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
