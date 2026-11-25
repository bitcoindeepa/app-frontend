"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/components/ui/toast";
import { useUnlockWithPasskey } from "@/hooks/query/usePasskey";
import { useSession } from "@/hooks/useSession";
import { TELEGRAM_BOT_URL } from "@/lib/constants";
import { passkeyCancelled, passkeyErrorMessage } from "@/lib/passkey";
import { haptic, usePlatform } from "@/platform";

/**
 * Full-screen cover over the web app (AppLockBoundary / useAppLock decide when). It
 * opens the browser's passkey prompt at once, and again whenever the app
 * comes back into focus; meanwhile only the logo shows. The locked screen
 * (unlock button, help, log out) appears only when that prompt is cancelled
 * or fails, e.g. a browser that wants a tap first. Unlocking also unlocks
 * this session on the backend. No in-app reset: a lost passkey is removed
 * by support once they've checked who's asking.
 */
export function PasskeyLock() {
  const unlock = useUnlockWithPasskey();
  const { logout } = useSession();
  const platform = usePlatform();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  // True while an automatic prompt is open: show only the logo behind it
  const [prompting, setPrompting] = useState(true);
  const inFlight = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Rendered straight into <body> and the only thing usable while it's up:
  // everything else (the dashboard, and sheets, which portal into <body>
  // themselves) is made inert, and focus moves here, so a sheet left open
  // behind the lock can't be operated from the keyboard
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const madeInert: HTMLElement[] = [];
    const disable = (el: Element) => {
      if (el === root || !(el instanceof HTMLElement) || el.inert) return;
      el.inert = true;
      madeInert.push(el);
    };
    Array.from(document.body.children).forEach(disable);
    // Not just once: anything added to <body> while locked (a sheet or dialog
    // portal, a page mounted by Back/Forward) is made inert as it appears
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => disable(node as Element));
    });
    observer.observe(document.body, { childList: true });
    // Remember what had focus, to give it back after unlocking
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previous?.blur();
    root.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      madeInert.forEach((el) => (el.inert = false));
      // Back where the member was, if that control is still there and usable;
      // otherwise focus stays on the page (the browser's default)
      if (
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        !previous.closest("[inert]") &&
        !previous.matches(":disabled")
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  const tryUnlock = (auto: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    unlock.mutate(undefined, {
      onSuccess: () => haptic.notify("success"),
      onError: (e) => {
        setPrompting(false);
        // An automatic prompt the browser refused (no tap yet) or the user
        // closed: the locked screen is enough, no error line
        if (auto && passkeyCancelled(e)) return;
        haptic.notify("error");
        setError(passkeyErrorMessage(e));
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };

  // On show, and each time the app comes back into focus
  useEffect(() => {
    tryUnlock(true);
    const onVisible = () => {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      setError(null);
      setPrompting(true);
      tryUnlock(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per lock
  }, []);

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

  const locked = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-lock-title"
      className="bg-background fixed inset-0 z-95 flex justify-center overflow-y-auto"
    >
      <div className="flex min-h-full w-full max-w-[440px] flex-col items-center px-6 pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="relative h-10 w-[160px]">
          <Logo priority />
        </div>

        <div className="mt-auto flex flex-col items-center gap-5 text-center">
          <span className="bg-chip text-ink2 flex size-20 items-center justify-center rounded-full">
            <svg
              className="size-10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
          <div className="flex flex-col gap-2">
            <h1 id="passkey-lock-title" className="font-display text-[22px] font-bold">
              Bitcoin Deepa is locked
            </h1>
            <p aria-live="polite" className="text-ink2 min-h-10 text-[14px] leading-5">
              {error ? (
                <span className="text-loss font-semibold">{error}</span>
              ) : (
                "Unlock with your passkey: Face ID, fingerprint or your device PIN."
              )}
            </p>
          </div>
        </div>

        <div className="mt-auto flex w-full flex-col items-center gap-1 pt-8">
          <Button
            loading={unlock.isPending && !prompting}
            onClick={() => {
              setError(null);
              tryUnlock(false);
            }}
          >
            Unlock with passkey
          </Button>
          {lost ? (
            <div className="bg-chip mt-3 flex w-full flex-col gap-3 rounded-xl p-4 text-center">
              <p className="text-ink2 text-[13px] leading-[18px] font-semibold">
                Lost the device with your passkey? Message us in the Bitcoin Deepa bot. Once
                we&apos;ve checked it&apos;s you, we&apos;ll remove it and you can add a new one.
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
            <Button size="text" variant="text" onClick={() => setLost(true)}>
              Can&apos;t use your passkey?
            </Button>
          )}
          <Button size="text" variant="text" className="text-loss" onClick={logOut}>
            Log out
          </Button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={rootRef} tabIndex={-1} className="outline-none">
      {prompting ? <PromptingCover /> : locked}
    </div>,
    document.body
  );
}

/** Behind the browser's automatic passkey prompt: only the logo */
function PromptingCover() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlocking Bitcoin Deepa"
      className="bg-background fixed inset-0 z-95 flex items-center justify-center"
    >
      <div className="relative h-14 w-[200px]">
        <Logo priority />
      </div>
    </div>
  );
}
