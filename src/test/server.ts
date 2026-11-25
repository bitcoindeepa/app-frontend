import { afterAll, afterEach, beforeAll } from "vitest";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";

/** The backend the tests talk to (NEXT_PUBLIC_API_BASE_URL in vitest.config.ts) */
export const API = "https://api.test";

export const server = setupServer();

/** A request the fake backend received */
export interface Seen {
  method: string;
  path: string;
  headers: Headers;
  /** The parsed JSON body, or undefined when there was none */
  body: unknown;
}

/**
 * Starts the fake backend for a test file. A request no handler answers
 * fails the test: nothing may reach the network unnoticed.
 */
export function startBackend() {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

type Reply = JsonBodyType | (() => JsonBodyType) | ((seen: Seen) => Response);

/**
 * Answers `METHOD path` on the backend and records each request it gets.
 * `reply` is the JSON to send (200), or a function that builds the response.
 *
 *   const sends = backend("POST", "/p2p/send", transfer);
 *   ...
 *   expect(sends[0].body).toEqual({ amount: 5 });
 */
export function backend(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  reply: Reply = {}
): Seen[] {
  const seen: Seen[] = [];
  const route = http[method.toLowerCase() as "get"];
  server.use(
    route(`${API}${path}`, async ({ request }) => {
      const text = await request.text();
      const entry: Seen = {
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      seen.push(entry);
      if (typeof reply !== "function") return HttpResponse.json(reply);
      const result = (reply as (seen: Seen) => unknown)(entry);
      return result instanceof Response ? result : HttpResponse.json(result as JsonBodyType);
    })
  );
  return seen;
}

/** An error response in the backend's shape */
export const failWith = (status: number, message: string, code?: string) => () =>
  HttpResponse.json(code ? { message, code } : { message }, { status });
