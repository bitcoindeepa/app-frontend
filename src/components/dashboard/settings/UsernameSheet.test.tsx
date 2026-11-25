// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend, type Seen } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { UsernameSheet } from "@/components/dashboard/settings/UsernameSheet";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

/** GET /user/username/availability: every name is free except "taken" */
function availability() {
  return backend("GET", "/user/username/availability", (seen: Seen) => {
    const username = new URLSearchParams(seen.query).get("username");
    return Response.json(
      username === "taken"
        ? { username, available: false, reason: "@taken is already taken" }
        : { username, available: true, reason: null }
    );
  });
}

async function open() {
  const onOpenChange = vi.fn();
  const view = renderScreen(<UsernameSheet open onOpenChange={onOpenChange} />);
  await screen.findByRole("dialog", { name: "Your username" });
  return { ...view, onOpenChange };
}

const field = () => screen.getByRole("textbox", { name: "Username" }) as HTMLInputElement;
const claimButton = () => screen.getByRole("button", { name: /^Claim/ }) as HTMLButtonElement;

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  await signInWeb();
});

describe("UsernameSheet", () => {
  it("says it's permanent, and can't be claimed before a name is typed", async () => {
    availability();
    await open();
    expect(
      screen.getByText("One per person, and it can't be changed later. Pick carefully.")
    ).toBeTruthy();
    expect(
      screen.getByText("3-20 letters, digits or underscores. Starts with a letter.")
    ).toBeTruthy();
    expect(claimButton().disabled).toBe(true);
  });

  it("checks a name once typing pauses, and offers to claim a free one", async () => {
    const checks = availability();
    const { user } = await open();

    await user.type(field(), "@Kasun_77");

    expect(await screen.findByText("@kasun_77 is available")).toBeTruthy();
    expect(field().value).toBe("kasun_77");
    expect(claimButton().textContent).toBe("Claim @kasun_77");
    expect(claimButton().disabled).toBe(false);
    // one request for the finished name, not one per keystroke
    expect(checks).toHaveLength(1);
    expect(checks[0].query).toBe("username=kasun_77");
  });

  it("says why a name can't be claimed", async () => {
    availability();
    const { user } = await open();
    await user.type(field(), "taken");
    expect(await screen.findByText("@taken is already taken")).toBeTruthy();
    expect(claimButton().disabled).toBe(true);
  });

  it.each(["ab", "1kasun", "ka-sun"])(
    "explains the rules for %j without asking the backend",
    async (typed) => {
      const checks = availability();
      const { user } = await open();
      await user.type(field(), typed);
      expect(
        await screen.findByText("Use 3-20 letters, digits or underscores, starting with a letter")
      ).toBeTruthy();
      expect(claimButton().disabled).toBe(true);
      expect(checks).toHaveLength(0);
    }
  );

  it("says so when the check itself fails", { timeout: 15_000 }, async () => {
    backend("GET", "/user/username/availability", failWith(400, "Bad request"));
    const { user } = await open();
    await user.type(field(), "kasun_77");
    expect(await screen.findByText("Couldn't check right now. Try again.")).toBeTruthy();
    expect(claimButton().disabled).toBe(true);
  });

  it("claims the name, updates the profile and closes", async () => {
    availability();
    const claims = backend("POST", "/user/username", userMe({ username: "kasun_77" }));
    const { user, onOpenChange, queryClient } = await open();
    await user.type(field(), "kasun_77");
    await screen.findByText("@kasun_77 is available");

    await user.click(claimButton());

    expect(await screen.findByText("You're @kasun_77")).toBeTruthy();
    expect(claims[0].body).toEqual({ username: "kasun_77" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(queryClient.getQueryData<{ username: string }>(["user-me"])?.username).toBe("kasun_77");
  });

  it("claims with Enter", async () => {
    availability();
    const claims = backend("POST", "/user/username", userMe({ username: "kasun_77" }));
    const { user } = await open();
    await user.type(field(), "kasun_77");
    await screen.findByText("@kasun_77 is available");

    await user.type(field(), "{Enter}");

    await waitFor(() => expect(claims).toHaveLength(1));
  });

  it("doesn't claim with Enter while the name is still being checked", async () => {
    availability();
    const claims = backend("POST", "/user/username", userMe());
    const { user } = await open();

    await user.type(field(), "kasun_77{Enter}");

    await screen.findByText("@kasun_77 is available");
    expect(claims).toHaveLength(0);
  });

  it("says why when the claim fails, e.g. someone else got there first", async () => {
    availability();
    backend("POST", "/user/username", failWith(409, "@kasun_77 was just taken"));
    const { user, onOpenChange } = await open();
    await user.type(field(), "kasun_77");
    await screen.findByText("@kasun_77 is available");

    await user.click(claimButton());

    expect(await screen.findByText("Couldn't claim it")).toBeTruthy();
    expect(screen.getByText("@kasun_77 was just taken")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
