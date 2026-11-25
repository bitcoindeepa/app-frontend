// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { onConfirmRequest, requestConfirm, type ConfirmRequest } from "@/platform/confirm";

const OPTIONS = {
  title: "Remove this passkey?",
  message: "You can add it again later.",
  confirmText: "Remove",
  destructive: true,
};

describe("requestConfirm", () => {
  it("hands the question to the mounted sheet and resolves with its answer", async () => {
    let asked: ConfirmRequest | undefined;
    const stop = onConfirmRequest((request) => (asked = request));

    const answer = requestConfirm(OPTIONS);
    expect(asked).toMatchObject(OPTIONS);

    asked?.resolve(false);
    await expect(answer).resolves.toBe(false);
    stop();
  });

  it("falls back to the browser's confirm box when no sheet is mounted", async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    await expect(requestConfirm(OPTIONS)).resolves.toBe(true);
    expect(nativeConfirm).toHaveBeenCalledExactlyOnceWith(
      "Remove this passkey?\n\nYou can add it again later."
    );
  });

  it("stops asking a sheet that has unmounted", async () => {
    const onRequest = vi.fn();
    const stop = onConfirmRequest(onRequest);
    stop();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false)
    );
    await expect(requestConfirm(OPTIONS)).resolves.toBe(false);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("keeps the newer sheet when an older one unmounts after it mounted", async () => {
    const older = vi.fn();
    const newer = vi.fn((request: ConfirmRequest) => request.resolve(true));
    const stopOlder = onConfirmRequest(older);
    const stopNewer = onConfirmRequest(newer);
    stopOlder();

    await expect(requestConfirm(OPTIONS)).resolves.toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
    stopNewer();
  });
});
