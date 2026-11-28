// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { queryKeys } from "@/lib/query-keys";
import { createTestQueryClient, renderScreen } from "@/test/render";
import { setPlatform, webPlatform } from "@/test/platform";
import PaymentSuccessPage from "./page";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

/** How many times the page asked for the current plan again */
const planRefreshes = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(
    ([filters]) =>
      JSON.stringify((filters as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify(queryKeys.subscriptionCurrent)
  ).length;

describe("plan payment success", () => {
  beforeEach(() => {
    setPlatform(webPlatform());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps refetching the plan for ~30 s, since the webhook usually lands after the redirect", async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderScreen(<PaymentSuccessPage />, { queryClient });

    expect(screen.getByText("Payment successful")).toBeTruthy();
    expect(planRefreshes(invalidate)).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(planRefreshes(invalidate)).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(planRefreshes(invalidate)).toBe(5);

    // And then stops
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(planRefreshes(invalidate)).toBe(5);
  });

  it("stops refetching once the member leaves the page", async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { unmount } = renderScreen(<PaymentSuccessPage />, { queryClient });

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(planRefreshes(invalidate)).toBe(1);
  });
});
