import { FetchyError } from "@/lib/fetchy";
import type { PasscodeErrorData } from "@/hooks/query/usePasscode";

/** A wait like "45s", "4:30" or "3 h 20 min" */
export function formatWait(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    return `${m}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${seconds}s`;
}

/**
 * What a failed passcode call means for the screen: a message, and when the
 * passcode is locked out, until when.
 */
export function passcodeFailure(error: unknown): { message: string; lockedUntil?: string } {
  if (!(error instanceof FetchyError)) {
    return { message: "Couldn't check it. Check your connection and try again." };
  }
  const data = (error.data ?? {}) as PasscodeErrorData;
  switch (error.code) {
    case "passcode_incorrect": {
      const left = data.attempts_before_lock ?? 0;
      return {
        message:
          left > 0
            ? `Wrong passcode. ${left} more ${left === 1 ? "try" : "tries"} before it locks for a while.`
            : "Wrong passcode. Another wrong try locks it for a while.",
      };
    }
    case "passcode_locked":
      return { message: "Too many wrong tries.", lockedUntil: data.locked_until };
    default:
      return { message: error.message || "Something went wrong. Try again." };
  }
}
