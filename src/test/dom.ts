import { act } from "@testing-library/react";
import { vi } from "vitest";

let visibility: DocumentVisibilityState = "visible";

/** The app goes to the background ("hidden") or comes back ("visible") */
export function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * Puts the page at `url` and returns spies for leaving it. jsdom can't
 * navigate, and its own location can't be spied on, so the whole object is
 * replaced (with every field a real one has: UI libraries read them).
 */
export function stubLocation(url = "/") {
  const parsed = new URL(url, "https://app.bitcoindeepa.com");
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => parsed.href,
  };
  vi.stubGlobal("location", location);
  return location;
}
