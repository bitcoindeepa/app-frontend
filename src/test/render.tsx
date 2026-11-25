import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, type RenderHookOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";
import { afterEach } from "vitest";

// Testing Library only unmounts by itself when the test globals are on; they're off here
afterEach(() => cleanup());

/** A query client for one test: no retries, so a failed request fails at once */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
}

/** renderHook inside a QueryClientProvider. Returns the client too, to read or seed its cache. */
export function renderHookWithClient<Result, Props>(
  hook: (props: Props) => Result,
  options: RenderHookOptions<Props> & { queryClient?: QueryClient } = {}
) {
  const { queryClient = createTestQueryClient(), ...rest } = options;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(hook, { wrapper, ...rest }) };
}

/**
 * Renders a screen the way the app does: inside the query client and the
 * toast provider. `user` taps and types like a person would.
 */
export function renderScreen(ui: ReactElement, options: { queryClient?: QueryClient } = {}) {
  const { queryClient = createTestQueryClient() } = options;
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
  return { user, queryClient, ...view };
}

/** Runs something that is expected to fail (inside act) and returns what it threw */
export async function failure<E = Error & Record<string, unknown>>(
  run: () => Promise<unknown>
): Promise<E> {
  let thrown: unknown;
  await act(async () => {
    try {
      await run();
    } catch (error) {
      thrown = error;
    }
  });
  if (thrown === undefined) throw new Error("Expected this to fail, but it succeeded");
  return thrown as E;
}
