// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { telegramPlatform, setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { ReloginPrompt } from "@/components/auth/ReloginPrompt";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  assign = stubLocation("/dashboard/sell/ord_1?from=activity").assign;
});

describe("ReloginPrompt", () => {
  describe("on the web", () => {
    it("asks the member to log in again, and comes back to this page", async () => {
      setPlatform(webPlatform());
      const { user } = renderScreen(<ReloginPrompt open onOpenChange={() => {}} />);

      expect(await screen.findByRole("dialog", { name: "Log in to send" })).toBeTruthy();
      expect(
        screen.getByText(/Log in with Telegram once more to connect your wallet/)
      ).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Log in with Telegram" }));

      expect(assign).toHaveBeenCalledExactlyOnceWith(
        "https://api.test/auth/telegram/start?return_to=%2Fdashboard%2Fsell%2Ford_1%3Ffrom%3Dactivity"
      );
      // the page the login returns to won't ask for the passkey
      expect(sessionStorage.getItem("bitcoin-deepa-login-started")).not.toBeNull();
    });

    it("names what the member was doing", async () => {
      setPlatform(webPlatform());
      renderScreen(<ReloginPrompt open onOpenChange={() => {}} action="pay" />);
      expect(await screen.findByRole("dialog", { name: "Log in to pay" })).toBeTruthy();
      expect(screen.getByText(/then pay again/)).toBeTruthy();
    });
  });

  describe("in the Mini App", () => {
    it("asks the member to reopen the app, and closes it", async () => {
      const platform = setPlatform(telegramPlatform());
      const { user } = renderScreen(<ReloginPrompt open onOpenChange={() => {}} />);

      expect(await screen.findByRole("dialog", { name: "Reopen to send" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Log in with Telegram" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Close the app" }));

      expect(platform.close).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });
  });

  it("shows nothing while closed", () => {
    setPlatform(webPlatform());
    renderScreen(<ReloginPrompt open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be dismissed", async () => {
    setPlatform(webPlatform());
    const onOpenChange = vi.fn();
    const { user } = renderScreen(<ReloginPrompt open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
