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
