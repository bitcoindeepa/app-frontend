// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { AvatarPickerSheet } from "@/components/dashboard/settings/AvatarPickerSheet";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
// Random pictures, made predictable: seed-1, seed-2, ...
const seeds = vi.hoisted(() => ({ next: 0 }));
vi.mock("@/lib/avatar", async (original) => ({
  ...(await original<typeof import("@/lib/avatar")>()),
  randomSeed: () => `seed-${++seeds.next}`,
}));

startBackend();

async function open(avatarSeed: string | null = "my-seed") {
  backend("GET", "/user/me", userMe({ avatar_seed: avatarSeed }));
  const onOpenChange = vi.fn();
  const view = renderScreen(<AvatarPickerSheet open onOpenChange={onOpenChange} />);
  await screen.findByRole("dialog", { name: "Profile picture" });
  await screen.findByRole("button", { name: "Current picture" });
  return { ...view, onOpenChange };
}

const useButton = () =>
  screen.getByRole("button", { name: "Use this picture" }) as HTMLButtonElement;
const tiles = () =>
  screen.getAllByRole("button", { name: /picture/i }).filter((b) => b.hasAttribute("aria-pressed"));

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  seeds.next = 0;
  await signInWeb();
});

describe("AvatarPickerSheet", () => {
  it("shows the current picture first among twelve, with nothing to save yet", async () => {
    await open();
    expect(tiles()).toHaveLength(12);
    const current = screen.getByRole("button", { name: "Current picture" });
    expect(tiles()[0]).toBe(current);
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(useButton().disabled).toBe(true);
  });

  it("uses the member's Telegram id for a picture until they pick one", async () => {
    await open(null);
    expect(screen.getByRole("button", { name: "Current picture" })).toBeTruthy();
    expect(tiles()).toHaveLength(12);
  });

  it("saves the picked picture's seed and closes", async () => {
    const saves = backend("PATCH", "/user/avatar", userMe({ avatar_seed: "seed-1" }));
    const { user, onOpenChange, queryClient } = await open();

    await user.click(screen.getByRole("button", { name: "Picture 2" }));
    expect(screen.getByRole("button", { name: "Picture 2" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(useButton().disabled).toBe(false);
    await user.click(useButton());

    expect(await screen.findByText("Profile picture updated")).toBeTruthy();
    // only the seed is sent: the app draws the picture
    expect(saves[0].body).toEqual({ seed: "seed-1" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(queryClient.getQueryData<{ avatar_seed: string }>(["user-me"])?.avatar_seed).toBe(
      "seed-1"
    );
  });

  it("saves nothing when the current picture is picked again", async () => {
    const saves = backend("PATCH", "/user/avatar", userMe());
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Picture 2" }));
    await user.click(screen.getByRole("button", { name: "Current picture" }));
    expect(useButton().disabled).toBe(true);
    expect(saves).toHaveLength(0);
  });

  it("shows new pictures on request, keeping the current one first", async () => {
    const { user } = await open();
    const before = tiles().map((tile) => tile.querySelector("img")?.getAttribute("src"));

    await user.click(screen.getByRole("button", { name: "Show me more" }));

    const after = tiles().map((tile) => tile.querySelector("img")?.getAttribute("src"));
    expect(after).toHaveLength(12);
    expect(after[0]).toBe(before[0]);
    expect(after.slice(1)).not.toEqual(before.slice(1));
  });

  it("says why when the picture can't be saved, and stays open", async () => {
    backend("PATCH", "/user/avatar", failWith(500, "Something went wrong"));
    const { user, onOpenChange } = await open();
    await user.click(screen.getByRole("button", { name: "Picture 2" }));

    await user.click(useButton());

    expect(await screen.findByText("Couldn't save")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(useButton().disabled).toBe(false));
  });
});
