// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { requestConfirm } from "@/platform/confirm";
import { ConfirmHost } from "@/components/ui/confirm-dialog";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());

const REMOVE = {
  title: "Remove bank account?",
  message: "Bank of Ceylon •••• 6789 won't get payouts any more.",
  confirmText: "Remove",
  cancelText: "Keep it",
  destructive: true,
};

describe("ConfirmHost", () => {
  it("shows nothing until something asks", () => {
    renderScreen(<ConfirmHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks the question in a sheet, and answers yes", async () => {
    const { user } = renderScreen(<ConfirmHost />);
    const answer = requestConfirm(REMOVE);

    const sheet = await screen.findByRole("dialog", { name: "Remove bank account?" });
    expect(sheet.textContent).toContain("won't get payouts any more");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("answers no from the other button, named as asked", async () => {
    const { user } = renderScreen(<ConfirmHost />);
    const answer = requestConfirm(REMOVE);
    await user.click(await screen.findByRole("button", { name: "Keep it" }));
    await expect(answer).resolves.toBe(false);
  });

  it("calls the other button Cancel by default", async () => {
    const { user } = renderScreen(<ConfirmHost />);
    const answer = requestConfirm({
      title: "Cancel sale",
      message: "Nothing will be sold.",
      confirmText: "Cancel sale",
    });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toBe(false);
  });

  it("counts closing the sheet as no", async () => {
    const { user } = renderScreen(<ConfirmHost />);
    const answer = requestConfirm(REMOVE);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await expect(answer).resolves.toBe(false);
  });

  it("answers no to a question that a newer one replaces", async () => {
    const { user } = renderScreen(<ConfirmHost />);
    const first = requestConfirm(REMOVE);
    await screen.findByRole("dialog", { name: "Remove bank account?" });

    const second = requestConfirm({
      title: "Cancel plan?",
      message: "It stops right away.",
      confirmText: "Cancel plan",
    });

    await expect(first).resolves.toBe(false);
    await screen.findByRole("dialog", { name: "Cancel plan?" });
    await user.click(screen.getByRole("button", { name: "Cancel plan" }));
    await expect(second).resolves.toBe(true);
  });

  it("stops taking questions once it is gone", async () => {
    const { unmount } = renderScreen(<ConfirmHost />);
    unmount();
    const nativeConfirm = vi.fn(() => false);
    vi.stubGlobal("confirm", nativeConfirm);
    await expect(requestConfirm(REMOVE)).resolves.toBe(false);
    expect(nativeConfirm).toHaveBeenCalledTimes(1);
  });
});
