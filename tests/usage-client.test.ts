import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCodexUsage, USAGE_ENDPOINT } from "../src/usage-client";

describe("usage client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the ChatGPT usage endpoint with Codex OAuth headers", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ rate_limit: { allowed: true } }), { status: 200 }),
    );

    const result = await fetchCodexUsage(
      { accessToken: "codex-token", accountId: "acct-123" },
      { fetchImpl },
    );

    expect(result).toEqual({ ok: true, raw: { rate_limit: { allowed: true } }, status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith(
      USAGE_ENDPOINT,
      expect.objectContaining({
        headers: {
          accept: "*/*",
          authorization: "Bearer codex-token",
          "chatgpt-account-id": "acct-123",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("does not inject fast-mode service_tier headers", async () => {
    const fetchImpl = vi.fn<((input: string | URL | Request, init?: RequestInit) => Promise<Response>)>(
      async () =>
        new Response(JSON.stringify({ rate_limit: { allowed: true } }), { status: 200 }),
    );

    await fetchCodexUsage(
      { accessToken: "codex-token", accountId: "acct-123" },
      { fetchImpl },
    );

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers;
    expect(headers).toBeDefined();
    expect(headers).not.toHaveProperty("service_tier");
  });

  it("aborts usage requests after the 10-second timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      },
    );

    const resultPromise = fetchCodexUsage(
      { accessToken: "codex-token", accountId: "acct-123" },
      { fetchImpl },
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: { kind: "timeout", message: "Codex usage request timed out" },
    });
  });

  it("pipes an available Pi abort signal into the usage request", async () => {
    const piAbort = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      },
    );

    const resultPromise = fetchCodexUsage(
      { accessToken: "codex-token", accountId: "acct-123" },
      { fetchImpl, signal: piAbort.signal },
    );

    piAbort.abort();

    expect(requestSignal?.aborted).toBe(true);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: { kind: "aborted", message: "Codex usage request was aborted" },
    });
  });

  it("classifies auth, non-auth HTTP, network, and invalid JSON failures without credential details", async () => {
    await expect(
      fetchCodexUsage(
        { accessToken: "secret-token", accountId: "acct-123" },
        { fetchImpl: vi.fn(async () => new Response("", { status: 401 })) },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "auth", status: 401, message: "Codex usage authentication failed (401)" },
    });

    await expect(
      fetchCodexUsage(
        { accessToken: "secret-token", accountId: "acct-123" },
        { fetchImpl: vi.fn(async () => new Response("", { status: 500 })) },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "http", status: 500, message: "Codex usage request failed (500)" },
    });

    await expect(
      fetchCodexUsage(
        { accessToken: "secret-token", accountId: "acct-123" },
        { fetchImpl: vi.fn(async () => { throw new Error("socket closed"); }) },
      ),
    ).resolves.toEqual({ ok: false, error: { kind: "network", message: "socket closed" } });

    await expect(
      fetchCodexUsage(
        { accessToken: "secret-token", accountId: "acct-123" },
        { fetchImpl: vi.fn(async () => new Response("not json", { status: 200 })) },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "parse", message: "Codex usage response was not valid JSON" },
    });
  });
});
