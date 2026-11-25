"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { PasscodePad } from "@/components/passcode/PasscodePad";
import { passcodeFailure } from "@/components/passcode/passcode-errors";
import { useChangePasscode, useDisablePasscode, useSetPasscode } from "@/hooks/query/usePasscode";
import { PASSCODE_LENGTH, passcodeProblem } from "@/lib/passcode";
import { haptic } from "@/platform";

export type PasscodeSheetMode = "set" | "change" | "disable";
type Step = "current" | "new" | "confirm";

const FIRST_STEP: Record<PasscodeSheetMode, Step> = {
  set: "new",
  change: "current",
  disable: "current",
};

const TITLES: Record<PasscodeSheetMode, string> = {
  set: "Set a passcode",
  change: "Change passcode",
  disable: "Turn off passcode",
};

const PROMPTS: Record<Step, string> = {
  current: "Enter your current passcode",
  new: `Choose a ${PASSCODE_LENGTH}-digit passcode`,
  confirm: "Enter it again to confirm",
};

/**
 * Turn the app passcode on, change it, or turn it off. Each step is a keypad
 * that moves on at six digits. A new passcode is checked here first (same
 * rules as the backend); the current one only when the request is sent.
 */
export function PasscodeSheet({
  mode,
  open,
  onOpenChange,
}: {
  mode: PasscodeSheetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const setPasscode = useSetPasscode();
  const changePasscode = useChangePasscode();
  const disablePasscode = useDisablePasscode();
  const pending = setPasscode.isPending || changePasscode.isPending || disablePasscode.isPending;

  const [step, setStep] = useState<Step>(FIRST_STEP[mode]);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const reset = () => {
    setStep(FIRST_STEP[mode]);
    setCode("");
    setCurrent("");
    setChosen("");
    setError(null);
  };

  const close = () => {
    onOpenChange(false);
    // After the slide-down, so the sheet doesn't jump back a step on its way out
    window.setTimeout(reset, 300);
  };

  const fail = (message: string, backTo: Step) => {
    haptic.notify("error");
    setShakeKey((k) => k + 1);
    setError(message);
    setCode("");
    setStep(backTo);
  };

  const done = (title: string) => {
    haptic.notify("success");
    toast({ title });
    close();
  };

  const onFailure = (e: unknown) => {
    const failure = passcodeFailure(e);
    // A wrong or locked current passcode starts over from it
    fail(failure.message, FIRST_STEP[mode]);
    if (failure.lockedUntil) {
      setError("Too many wrong tries. Try again later.");
    }
  };

  const complete = (value: string) => {
    if (step === "current") {
      if (mode === "disable") {
        disablePasscode.mutate(value, {
          onSuccess: () => done("Passcode turned off"),
          onError: onFailure,
        });
        return;
      }
      setCurrent(value);
      setCode("");
      setError(null);
      setStep("new");
      return;
    }
    if (step === "new") {
      const problem = passcodeProblem(value);
      if (problem) return fail(problem, "new");
      if (mode === "change" && value === current) {
        return fail("Pick a passcode different from your current one.", "new");
      }
      setChosen(value);
      setCode("");
      setError(null);
      setStep("confirm");
      return;
    }
    if (value !== chosen) {
      setChosen("");
      return fail("Those didn't match. Choose your passcode again.", "new");
    }
    if (mode === "set") {
      setPasscode.mutate(value, {
        onSuccess: () => done("Passcode on. We'll ask for it when you open the app."),
        onError: (e) => fail(passcodeFailure(e).message, "new"),
      });
    } else {
      changePasscode.mutate(
        { current, passcode: value },
        { onSuccess: () => done("Passcode changed"), onError: onFailure }
      );
    }
  };

  const onChange = (next: string) => {
    setCode(next);
    if (error) setError(null);
    if (next.length === PASSCODE_LENGTH) complete(next);
  };

  const back =
    step === "confirm"
      ? () => {
          setStep("new");
          setCode("");
          setChosen("");
          setError(null);
        }
      : step === "new" && mode === "change"
        ? () => {
            setStep("current");
            setCode("");
            setCurrent("");
            setError(null);
          }
        : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) onOpenChange(true);
        else close();
      }}
      title={TITLES[mode]}
      onBack={back}
      hideClose={pending}
      flow
    >
      <div className="flex flex-col items-center gap-6 px-4 pt-2 pb-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-[17px] font-bold">{PROMPTS[step]}</p>
          <p
            aria-live="polite"
            className={
              error
                ? "text-loss min-h-9 text-[13px] leading-[18px] font-semibold"
                : "text-ink3 min-h-9 text-[13px] leading-[18px] font-semibold"
            }
          >
            {error ??
              (step === "new"
                ? "Not your bank PIN, and nothing easy like 123456 or 111111."
                : mode === "disable"
                  ? "Anyone with your phone will be able to open the app."
                  : "")}
          </p>
        </div>
        <PasscodePad
          value={code}
          onChange={onChange}
          disabled={pending}
          shakeKey={shakeKey}
          label={PROMPTS[step]}
        />
      </div>
    </Sheet>
  );
}
