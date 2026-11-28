// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOGIN_KEY = "bitcoin-deepa-login-started";
const HINT_KEY = "bitcoin-deepa-passkey-on";
const MINUTE = 60_000;

/** A fresh copy of the module, as on a page load: it decides then whether it starts locked */
async function loadAppLock() {
  vi.resetModules();
  return import("@/lib/app-lock");
}

/** The page a "Log In with Telegram" redirect came back to */
async function loadAfterLogin() {
  sessionStorage.setItem(LOGIN_KEY, String(Date.now()));
  return loadAppLock();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T04:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("on load", () => {
  it("starts locked", async () => {
    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getJustLoggedInSnapshot()).toBe(false);
    expect(lock.getUnlockNeededSnapshot()).toBe(false);
    expect(lock.getPasskeyRequiredSnapshot()).toBe(0);
  });

  it("is never locked on the server", async () => {
    const lock = await loadAppLock();
    expect(lock.getServerAppLockSnapshot()).toBe(false);
  });

  it("starts unlocked on the page a login comes back to", async () => {
    const first = await loadAppLock();
    first.markLoginStarted();
    vi.advanceTimersByTime(30_000);

    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(false);
    expect(lock.getJustLoggedInSnapshot()).toBe(true);
  });

  it("counts the login once: the next load is locked again", async () => {
    await loadAfterLogin();
    expect(sessionStorage.getItem(LOGIN_KEY)).toBeNull();

    const next = await loadAppLock();
    expect(next.getAppLockSnapshot()).toBe(true);
    expect(next.getJustLoggedInSnapshot()).toBe(false);
  });

  it("counts a login that started just under 10 minutes ago", async () => {
    sessionStorage.setItem(LOGIN_KEY, String(Date.now() - 10 * MINUTE + 1));
    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(false);
  });

  it("ignores a login that started 10 minutes ago or more", async () => {
    sessionStorage.setItem(LOGIN_KEY, String(Date.now() - 10 * MINUTE));
    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getJustLoggedInSnapshot()).toBe(false);
    expect(sessionStorage.getItem(LOGIN_KEY)).toBeNull();
  });

  it.each(["", "true", "not a time", "0", "-5"])(
    "ignores the login mark %j and starts locked",
    async (value) => {
      sessionStorage.setItem(LOGIN_KEY, value);
      const lock = await loadAppLock();
      expect(lock.getAppLockSnapshot()).toBe(true);
    }
  );

  it("doesn't take a login mark from localStorage", async () => {
    localStorage.setItem(LOGIN_KEY, String(Date.now()));
    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(true);
  });

  it("starts locked when storage can't be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const lock = await loadAppLock();
    expect(lock.getAppLockSnapshot()).toBe(true);
  });
});

describe("markLoginStarted", () => {
  it("notes the time in this tab's sessionStorage only", async () => {
    const lock = await loadAppLock();
    lock.markLoginStarted();
    expect(sessionStorage.getItem(LOGIN_KEY)).toBe(String(Date.now()));
    expect(localStorage.getItem(LOGIN_KEY)).toBeNull();
  });

  it("doesn't stop the login when storage is blocked", async () => {
    const lock = await loadAppLock();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => lock.markLoginStarted()).not.toThrow();
  });
});

describe("locking and unlocking", () => {
  it("unlocks, and tells subscribers", async () => {
    const lock = await loadAppLock();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);

    lock.unlockApp();
    expect(lock.getAppLockSnapshot()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);

    lock.unlockApp();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("locks again, and tells subscribers", async () => {
    const lock = await loadAppLock();
    lock.unlockApp();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);

    lock.lockApp();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    lock.lockApp();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that left", async () => {
    const lock = await loadAppLock();
    const onChange = vi.fn();
    const unsubscribe = lock.subscribeAppLock(onChange);
    unsubscribe();
    lock.unlockApp();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("relocking after a login ends the just-logged-in pass", async () => {
    const lock = await loadAfterLogin();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);

    lock.lockApp();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getJustLoggedInSnapshot()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("unlocking after a login keeps the pass until the app relocks", async () => {
    const lock = await loadAfterLogin();
    lock.unlockApp();
    expect(lock.getAppLockSnapshot()).toBe(false);
    expect(lock.getJustLoggedInSnapshot()).toBe(true);
  });
});

describe("403 passkey_required", () => {
  it("locks the app and counts the refusal", async () => {
    const lock = await loadAppLock();
    lock.unlockApp();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);

    lock.passkeyRequired();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getUnlockNeededSnapshot()).toBe(true);
    expect(lock.getPasskeyRequiredSnapshot()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    lock.passkeyRequired();
    expect(lock.getPasskeyRequiredSnapshot()).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("locks the app even on the page a login came back to", async () => {
    const lock = await loadAfterLogin();
    lock.passkeyRequired();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getUnlockNeededSnapshot()).toBe(true);
  });

  it("is cleared by unlocking with the passkey", async () => {
    const lock = await loadAppLock();
    lock.passkeyRequired();
    lock.unlockApp();
    expect(lock.getAppLockSnapshot()).toBe(false);
    expect(lock.getUnlockNeededSnapshot()).toBe(false);
  });
});

describe("clearLaunchLock", () => {
  it("drops the lock from opening the app", async () => {
    const lock = await loadAppLock();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);
    lock.clearLaunchLock();
    expect(lock.getAppLockSnapshot()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the app locked while the backend still wants the passkey", async () => {
    const lock = await loadAppLock();
    lock.passkeyRequired();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);

    lock.clearLaunchLock();
    expect(lock.getAppLockSnapshot()).toBe(true);
    expect(lock.getUnlockNeededSnapshot()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does nothing when the app isn't locked", async () => {
    const lock = await loadAppLock();
    lock.unlockApp();
    const onChange = vi.fn();
    lock.subscribeAppLock(onChange);
    lock.clearLaunchLock();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("locksOnOpen", () => {
  it.each([
    [{ enabled: true, lock_on_open: true }, true],
    [{ enabled: true, lock_on_open: false }, false],
    // an older backend without the setting always asked
    [{ enabled: true }, true],
    [{ enabled: false, lock_on_open: true }, false],
    [{ enabled: false }, false],
  ])("%j -> %s", async (status, expected) => {
    const lock = await loadAppLock();
    expect(lock.locksOnOpen(status)).toBe(expected);
  });
});

describe("the passkey hint", () => {
  it("is off until written", async () => {
    const lock = await loadAppLock();
    expect(lock.readPasskeyHint()).toBe(false);
  });

  it("is kept in localStorage and removed when turned off", async () => {
    const lock = await loadAppLock();
    lock.writePasskeyHint(true);
    expect(localStorage.getItem(HINT_KEY)).toBe("true");
    expect(lock.readPasskeyHint()).toBe(true);

    lock.writePasskeyHint(false);
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
    expect(lock.readPasskeyHint()).toBe(false);
  });

  it("is off, without an error, when storage is blocked", async () => {
    const lock = await loadAppLock();
    const blocked = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    expect(lock.readPasskeyHint()).toBe(false);
    expect(() => lock.writePasskeyHint(true)).not.toThrow();
    expect(() => lock.writePasskeyHint(false)).not.toThrow();
  });
});
