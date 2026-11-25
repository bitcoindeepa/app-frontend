// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe } from "@/test/fixtures";
import { setPlatform, telegramPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import type { UserMe } from "@/hooks/query/useUserMe";
import VerificationDetailsPage from "@/app/verification/details/page";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));

startBackend();

/** A member who hasn't given any details yet */
const NEW_MEMBER = userMe({
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  address: null,
  city: null,
  country: null,
  is_profile_complete: false,
});

const DETAILS = {
  first_name: "Nimal",
  last_name: "Silva",
  email: "nimal@example.com",
  phone: "+94771234567",
  address: "12 Galle Road",
  city: "Colombo",
  country: "Sri Lanka",
};

let location: ReturnType<typeof stubLocation>;

async function open(profile: UserMe = NEW_MEMBER) {
  const me = backend("GET", "/user/me", profile);
  backend("GET", "/subscription/current", failWith(404, "No subscription"));
  backend("GET", "/user/kyc/status", { status: "NOT_STARTED" });
  const view = renderScreen(<VerificationDetailsPage />);
  await waitFor(() => expect(me.length).toBeGreaterThan(0));
  return view;
}

type User = Awaited<ReturnType<typeof open>>["user"];
const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const startButton = () =>
  screen.getByRole("button", { name: "Start verification" }) as HTMLButtonElement;

/** Fills in everything a new member has to (the country is already Sri Lanka) */
async function fillIn(user: User, phone = "077 123 4567") {
  await user.type(field("First name"), "Nimal");
  await user.type(field("Last name"), "Silva");
  await user.type(field("Email"), "nimal@example.com");
  await user.type(field("Phone"), phone);
  await user.type(field("Address"), "12 Galle Road");
  await user.type(field("City"), "Colombo");
}

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform({ isMobileDevice: true }));
  location = stubLocation("/verification/details");
  router.push.mockReset();
  await signInWeb();
});

describe("the verification details page", () => {
  describe("the form", () => {
    it("starts with Sri Lanka as the country and can't be sent until it is complete", async () => {
      const { user } = await open();
      expect(field("Country").value).toBe("Sri Lanka");
      expect(startButton().disabled).toBe(true);

      await fillIn(user);
      expect(startButton().disabled).toBe(false);
    });

    it("fills in what the member saved before, e.g. when verifying again", async () => {
      await open(userMe());
      await waitFor(() => expect(field("Email").value).toBe("nimal@example.com"));
      expect(field("First name").value).toBe("Nimal");
      expect(field("Phone").value).toBe("+94771234567");
      expect(field("City").value).toBe("Colombo");
      expect(startButton().disabled).toBe(false);
    });

    it("in Telegram, starts with the member's Telegram name", async () => {
      signOut();
      setPlatform({
        ...telegramPlatform(),
        launch: { raw: {}, initDataRaw: "x", user: { id: 777, firstName: "Nimal", lastName: "S" } },
      });
      await signInMiniApp();
      await open();
      expect(field("First name").value).toBe("Nimal");
      expect(field("Last name").value).toBe("S");
    });

    it("says what is wrong with a field as it is typed", async () => {
      const { user } = await open();
      await user.type(field("Email"), "nimal@");
      expect(await screen.findByText("Please provide a valid email address")).toBeTruthy();

      await user.type(field("Email"), "example.com");
      await waitFor(() =>
        expect(screen.queryByText("Please provide a valid email address")).toBeNull()
      );
    });

    it("only takes a Sri Lankan phone number", async () => {
      const { user } = await open();
      await fillIn(user, "+1 415 555 0100");
      expect(await screen.findByText("Enter a Sri Lankan number, e.g. 0771234567")).toBeTruthy();
      expect(startButton().disabled).toBe(true);
    });
  });

  describe("starting", () => {
    it("saves the details, starts a verification with them, and goes to the provider", async () => {
      const order: string[] = [];
      const saved = backend("POST", "/user", () => {
        order.push("profile");
        return { success: true };
      });
      const started = backend("POST", "/user/kyc/initiate", () => {
        order.push("kyc");
        return { url: "https://verify.example/session/abc" };
      });
      const { user } = await open();
      await fillIn(user);

      await user.click(startButton());

      await waitFor(() => expect(location.href).toBe("https://verify.example/session/abc"));
      expect(order).toEqual(["profile", "kyc"]);
      // the phone is sent in the +94 form the backend expects
      expect(saved[0].body).toEqual(DETAILS);
      expect(started[0].body).toEqual({ user_id: 777, username: "nimal", ...DETAILS });
    });

    it("starts no verification when the details can't be saved", async () => {
      backend("POST", "/user", failWith(400, "This email is already used by another member"));
      const started = backend("POST", "/user/kyc/initiate", { url: "https://verify.example/x" });
      const { user } = await open();
      await fillIn(user);

      await user.click(startButton());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("This email is already used by another member");
      expect(started).toHaveLength(0);
      expect(location.href).toBe("https://app.bitcoindeepa.com/verification/details");
    });

    it("shows the reason when the verification can't be started, and can be tried again", async () => {
      backend("POST", "/user", { success: true });
      backend("POST", "/user/kyc/initiate", failWith(503, "The verification service is down"));
      const { user } = await open();
      await fillIn(user);

      await user.click(startButton());

      expect((await screen.findByRole("alert")).textContent).toContain(
        "The verification service is down"
      );
      expect(startButton().disabled).toBe(false);
    });

    it("stays on the page when the backend returns no link", async () => {
      backend("POST", "/user", { success: true });
      const started = backend("POST", "/user/kyc/initiate", { message: "Already verified" });
      const { user } = await open();
      await fillIn(user);

      await user.click(startButton());

      await waitFor(() => expect(started).toHaveLength(1));
      expect(location.href).toBe("https://app.bitcoindeepa.com/verification/details");
    });
  });

  it("goes back to the verification page", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification");
  });
});
