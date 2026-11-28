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
  /** The query string, without the "?" */
  query: string;
  headers: Headers;
  /** The parsed JSON body (the text, when it isn't JSON), or undefined when there was none */
  body: unknown;
  /** Size of the body as sent */
  bytes: number;
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
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Answers `METHOD url` (a full URL) and records each request it gets. Use
 * `backend` for the app's own backend; this is for anything else the app
 * talks to, such as a presigned storage upload.
 */
export function answer(method: Method, url: string, reply: Reply = {}): Seen[] {
  const seen: Seen[] = [];
  const route = http[method.toLowerCase() as "get"];
  server.use(
    route(url, async ({ request }) => {
      const bytes = await request.arrayBuffer();
      const text = new TextDecoder().decode(bytes);
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        // not JSON (an uploaded file): keep it as text
        body = text;
      }
      const entry: Seen = {
        method: request.method,
        path: new URL(request.url).pathname,
        query: new URL(request.url).search.slice(1),
        headers: request.headers,
        body,
        bytes: bytes.byteLength,
      };
      seen.push(entry);
      if (typeof reply !== "function") return HttpResponse.json(reply);
      const result = (reply as (seen: Seen) => unknown)(entry);
      return result instanceof Response ? result : HttpResponse.json(result as JsonBodyType);
    })
  );
  return seen;
}

/**
 * Answers `METHOD path` on the backend and records each request it gets.
 * `reply` is the JSON to send (200), or a function that builds the response.
 *
 *   const sends = backend("POST", "/p2p/send", transfer);
 *   ...
 *   expect(sends[0].body).toEqual({ amount: 5 });
 */
export const backend = (method: Method, path: string, reply: Reply = {}): Seen[] =>
  answer(method, `${API}${path}`, reply);

/** An error response in the backend's shape */
export const failWith = (status: number, message: string, code?: string) => () =>
  HttpResponse.json(code ? { message, code } : { message }, { status });
