"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/components/ui/toast";
import { usePasscodeStatus, useVerifyPasscode } from "@/hooks/query/usePasscode";
import { useSecondsLeft } from "@/hooks/useSecondsLeft";
import { useSession } from "@/hooks/useSession";
import { TELEGRAM_BOT_URL } from "@/lib/constants";
import { PASSCODE_LENGTH } from "@/lib/passcode";
import { haptic, usePlatform } from "@/platform";
import { PasscodePad } from "./PasscodePad";
import { formatWait, passcodeFailure } from "./passcode-errors";

/**
 * Full-screen lock over the dashboard (useAppLock decides when). Entering the
 * passcode unlocks this session on the backend too. After too many wrong
 * tries the keypad waits out the lock the backend reports. There's no
 * in-app reset: a forgotten passcode is removed by support once they've
 * checked who's asking.
 */
export function PasscodeLock() {
  const { data } = usePasscodeStatus();
  const verify = useVerifyPasscode();
  const { logout } = useSession();
  const platform = usePlatform();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<string | undefined>();
  const [forgot, setForgot] = useState(false);

  const until = lockedUntil ?? data?.locked_until ?? undefined;
  const secondsLeft = useSecondsLeft(until);
  const lockedOut = secondsLeft > 0;

  const submit = (passcode: string) => {
    verify.mutate(passcode, {
      onSuccess: () => {
        haptic.notify("success");
        setCode("");
        setError(null);
      },
      onError: (e) => {
        haptic.notify("error");
        const failure = passcodeFailure(e);
        setCode("");
        setShakeKey((k) => k + 1);
        // A lockout shows its own countdown line instead
        setError(failure.lockedUntil ? null : failure.message);
        if (failure.lockedUntil) setLockedUntil(failure.lockedUntil);
      },
    });
  };

  const onChange = (next: string) => {
    setCode(next);
    if (error && !lockedOut) setError(null);
    if (next.length === PASSCODE_LENGTH) submit(next);
  };

  const logOut = () => {
    haptic.impact("medium");
    logout(false).catch(() => {
      toast({
        type: "error",
        title: "Couldn't log out",
        description: "Check your connection and try again.",
      });
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passcode-lock-title"
      className="bg-background fixed inset-0 z-95 flex justify-center overflow-y-auto"
    >
      <div className="flex min-h-full w-full max-w-[440px] flex-col items-center px-6 pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="relative h-10 w-[160px]">
          <Logo priority />
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <h1 id="passcode-lock-title" className="font-display text-[22px] font-bold">
            Enter your passcode
          </h1>
          <p aria-live="polite" className="text-ink2 min-h-10 text-[14px] leading-5">
            {lockedOut ? (
              <span className="text-loss font-semibold">
                Too many wrong tries. Try again in {formatWait(secondsLeft)}.
              </span>
            ) : error ? (
              <span className="text-loss font-semibold">{error}</span>
            ) : (
              "Keeps your sats safe if someone else picks up your phone."
            )}
          </p>
        </div>

        <div className="mt-8 w-full">
          <PasscodePad
            value={code}
            onChange={onChange}
            disabled={verify.isPending || lockedOut}
            shakeKey={shakeKey}
          />
        </div>

        <div className="mt-auto flex w-full flex-col items-center gap-1 pt-8">
          {forgot ? (
            <div className="bg-chip flex w-full flex-col gap-3 rounded-xl p-4 text-center">
              <p className="text-ink2 text-[13px] leading-[18px] font-semibold">
                For your safety it can&apos;t be reset in the app. Message us in the Bitcoin Deepa
                bot: once we&apos;ve checked it&apos;s you, we&apos;ll remove it and you can set a
                new one.
              </p>
              <Button
                size="default"
                variant="secondary"
                onClick={() => platform.openTelegramLink(TELEGRAM_BOT_URL)}
              >
                Message support
              </Button>
            </div>
          ) : (
            <Button size="text" variant="text" onClick={() => setForgot(true)}>
              Forgot passcode?
            </Button>
          )}
          <Button size="text" variant="text" className="text-loss" onClick={logOut}>
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}
