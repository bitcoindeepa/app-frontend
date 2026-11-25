/**
 * Local half of the app passcode lock (the backend's GET /passcode is the
 * other half). The app locks itself:
 * - when the backend answers 403 passcode_required (fetchy calls
 *   lockApp), e.g. the 12 h unlock ran out mid-session
 * - when it comes back after RELOCK_AFTER_MS in the background
 * Entering the passcode (POST /passcode/verify) unlocks both.
 *
 * `bitcoin-deepa-passcode-on` (localStorage) only remembers that this device's
 * member has a passcode, so the lock screen shows at once on launch instead
 * of flashing balances while GET /passcode loads. It's a UX hint: the backend
 * still refuses money-moving calls from a locked session.
 */

export const RELOCK_AFTER_MS = 60_000;
const HINT_KEY = "bitcoin-deepa-passcode-on";

const listeners = new Set<() => void>();
// Starts locked: opening the app asks for the passcode (when there is one)
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

export function readPasscodeHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "true";
  } catch {
    return false;
  }
}

export function writePasscodeHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(HINT_KEY, "true");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage blocked: the lock still shows once GET /passcode answers
  }
}
