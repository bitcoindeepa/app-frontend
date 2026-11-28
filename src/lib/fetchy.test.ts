import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchy's three neighbours, replaced so each test sets the base URL and the
// Mini App token and sees what fetchy tells auth and the app lock.
const env = vi.hoisted(() => ({ apiBaseUrl: "https://api.test", token: null as string | null }));
const onUnauthorized = vi.hoisted(() => vi.fn());
const passkeyRequired = vi.hoisted(() => vi.fn());

vi.mock("@/lib/constants", () => ({
  get API_BASE_URL() {
    return env.apiBaseUrl;
  },
}));
vi.mock("@/lib/auth", () => ({ getMiniAppToken: () => env.token, onUnauthorized }));
vi.mock("@/lib/app-lock", () => ({ passkeyRequired }));

import fetchy, { FetchyError } from "@/lib/fetchy";

const fetchMock = vi.fn<typeof fetch>();

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

/** What the next requests are answered with (a new Response each: a body reads once) */
const respond = (status: number, body?: unknown) =>
  fetchMock.mockImplementation(async () => reply(status, body));

/** The URL and options of the only request made */
function sent() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  return { url, init: init as RequestInit & { headers: Record<string, string> } };
}

/** The FetchyError a request fails with */
async function failure(request: Promise<unknown>): Promise<FetchyError> {
  const error = await request.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(FetchyError);
  return error as FetchyError;
}

beforeEach(() => {
  env.apiBaseUrl = "https://api.test";
  env.token = null;
  onUnauthorized.mockReset();
  passkeyRequired.mockReset();
  fetchMock.mockReset();
  respond(200, {});
  vi.stubGlobal("fetch", fetchMock);
});

describe("where a request goes", () => {
  it("sends a backend path to the API with the session cookie", async () => {
    await fetchy.get("/package");
    const { url, init } = sent();
    expect(url).toBe("https://api.test/package");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("adds the Mini App's token as a Bearer header", async () => {
    env.token = "miniapp-token";
    await fetchy.get("/package");
    expect(sent().init.headers.Authorization).toBe("Bearer miniapp-token");
  });

  it("keeps /api/ on this app, without the cookie or the token", async () => {
    env.token = "miniapp-token";
    await fetchy.get("/api/user");
    const { url, init } = sent();
    expect(url).toBe("/api/user");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("never sends the cookie or the token to another site", async () => {
    env.token = "miniapp-token";
    await fetchy.get("https://other.example/feed.json");
    const { url, init } = sent();
    expect(url).toBe("https://other.example/feed.json");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it.each(["//evil.example/package", "package", "javascript:alert(1)", "ftp://files.example/a"])(
    "refuses the URL %s",
    async (url) => {
      env.token = "miniapp-token";
      await expect(fetchy.get(url)).rejects.toThrow(`fetchy: unsupported URL "${url}"`);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("refuses a backend path when the API URL isn't set", async () => {
    env.apiBaseUrl = "";
    await expect(fetchy.get("/package")).rejects.toThrow(
      "fetchy: NEXT_PUBLIC_API_BASE_URL is not set"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what a request carries", () => {
  it.each([
    ["post", "POST"],
    ["put", "PUT"],
    ["patch", "PATCH"],
  ] as const)("%s sends the body as JSON", async (verb, method) => {
    await fetchy[verb]("/sell/quote", { sats: 1000 });
    const { init } = sent();
    expect(init.method).toBe(method);
    expect(init.body).toBe('{"sats":1000}');
  });

  it("sends no body when there's none", async () => {
    await fetchy.post("/auth/logout");
    expect(sent().init.body).toBeUndefined();
    fetchMock.mockClear();
    await fetchy.delete("/passkey/abc");
    expect(sent().init.method).toBe("DELETE");
    expect(sent().init.body).toBeUndefined();
  });

  it("adds the caller's headers, such as the passkey approval", async () => {
    env.token = "miniapp-token";
    await fetchy.post("/p2p/send", { amount: 5 }, { headers: { "X-Passkey-Assertion": "abc" } });
    expect(sent().init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer miniapp-token",
      "X-Passkey-Assertion": "abc",
    });
  });

  it("passes other options on, but not the method", async () => {
    const { signal } = new AbortController();
    await fetchy.get("/package", { signal, method: "DELETE" } as Parameters<typeof fetchy.get>[1]);
    expect(sent().init.signal).toBe(signal);
    expect(sent().init.method).toBe("GET");
  });
});

describe("what comes back", () => {
  it("parses JSON", async () => {
    respond(200, { plans: [1, 2] });
    await expect(fetchy.get("/package")).resolves.toEqual({ plans: [1, 2] });
  });

  it("is undefined for an empty response", async () => {
    respond(204);
    await expect(fetchy.post("/auth/logout")).resolves.toBeUndefined();
  });

  it("returns text that isn't JSON as it is", async () => {
    respond(200, "pong");
    await expect(fetchy.get("/health")).resolves.toBe("pong");
  });
});

describe("errors", () => {
  it("throws the backend's message, status, code and body", async () => {
    const body = { message: "Not enough sats", code: "insufficient_balance", balance: 12 };
    respond(400, body);
    const error = await failure(fetchy.post("/p2p/send", { amount: 50 }));
    expect(error.name).toBe("FetchyError");
    expect(error.message).toBe("Not enough sats");
    expect(error.status).toBe(400);
    expect(error.code).toBe("insufficient_balance");
    expect(error.data).toEqual(body);
  });

  it("joins a list of validation messages", async () => {
    respond(400, { message: ["email must be an email", "phone is required"] });
    const error = await failure(fetchy.post("/user", {}));
    expect(error.message).toBe("email must be an email, phone is required");
  });

  it("has a message of its own when the backend sends none", async () => {
    respond(502, "<html>Bad gateway</html>");
    const error = await failure(fetchy.get("/package"));
    expect(error.message).toBe("Request failed with status 502");
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
  });

  it("ignores a code that isn't text", async () => {
    respond(400, { message: "Bad request", code: 42 });
    expect((await failure(fetchy.get("/package"))).code).toBeUndefined();
  });

  it("lets a network failure through", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchy.get("/package")).rejects.toThrow("Failed to fetch");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("a 401 ends the session", () => {
  it("on the web, where the request carried the cookie", async () => {
    respond(401, { message: "Unauthorized" });
    const error = await failure(fetchy.get("/user/me"));
    expect(error.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("in the Mini App, naming the token the request carried", async () => {
    env.token = "old-token";
    fetchMock.mockImplementation(async () => {
      // A new session started while this request was in flight
      env.token = "new-token";
      return reply(401, { message: "Unauthorized" });
    });
    await failure(fetchy.get("/user/me"));
    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith("old-token");
  });

  it("but not when the 401 says relogin_required", async () => {
    respond(401, { message: "Log in again", code: "relogin_required" });
    const error = await failure(fetchy.post("/p2p/send", { amount: 5 }));
    expect(error.code).toBe("relogin_required");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("and not for a 401 from this app's own /api/ or another site", async () => {
    respond(401, { message: "Unauthorized" });
    await failure(fetchy.get("/api/user"));
    await failure(fetchy.get("https://other.example/feed.json"));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("a 403", () => {
  it("relogin_required never signs the user out", async () => {
    respond(403, { message: "Log in again", code: "relogin_required" });
    const error = await failure(fetchy.post("/p2p/send", { amount: 5 }));
    expect(error.status).toBe(403);
    expect(error.code).toBe("relogin_required");
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(passkeyRequired).not.toHaveBeenCalled();
  });

  it("passkey_required locks the app and still reaches the caller", async () => {
    respond(403, { message: "Unlock with your passkey", code: "passkey_required" });
    const error = await failure(fetchy.post("/bank-accounts", {}));
    expect(error.code).toBe("passkey_required");
    expect(passkeyRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("with any other code doesn't lock the app", async () => {
    respond(403, { message: "Forbidden", code: "kyc_required" });
    await failure(fetchy.post("/sell/quote", {}));
    expect(passkeyRequired).not.toHaveBeenCalled();
  });

  it("passkey_required from somewhere other than the backend doesn't lock the app", async () => {
    respond(403, { code: "passkey_required" });
    await failure(fetchy.get("/api/user"));
    await failure(fetchy.get("https://other.example/feed.json"));
    expect(passkeyRequired).not.toHaveBeenCalled();
  });

  it("only a 403 locks the app, whatever the code says", async () => {
    respond(400, { code: "passkey_required" });
    await failure(fetchy.post("/bank-accounts", {}));
    expect(passkeyRequired).not.toHaveBeenCalled();
  });
});

describe("putRaw", () => {
  const file = new Blob(["statement"], { type: "application/pdf" });

  it("uploads the file as it is, with no token or cookie", async () => {
    env.token = "miniapp-token";
    await fetchy.putRaw("https://storage.example/upload?sig=abc", file, {
      "Content-Type": "application/pdf",
    });
    const { url, init } = sent();
    expect(url).toBe("https://storage.example/upload?sig=abc");
    expect(init).toEqual({
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
  });

  it("allows a local storage server during development", async () => {
    await fetchy.putRaw("http://localhost:9000/bucket/key", file);
    await fetchy.putRaw("http://localhost/bucket/key", file);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://storage.example/upload",
    "http://localhost.evil.example/upload",
    "http://localhost:9000@evil.example/upload",
    "/upload",
    "//storage.example/upload",
  ])("refuses to upload to %s", async (url) => {
    await expect(fetchy.putRaw(url, file)).rejects.toThrow(
      "fetchy.putRaw: only absolute https URLs are allowed"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the upload fails, without ending the session", async () => {
    respond(403, "<Error>SignatureDoesNotMatch</Error>");
    const error = await failure(fetchy.putRaw("https://storage.example/upload", file));
    expect(error.message).toBe("Upload failed with status 403");
    expect(error.status).toBe(403);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(passkeyRequired).not.toHaveBeenCalled();
  });
});
