import { describe, expect, it, vi } from "vitest";

import { createUsageRefreshCoordinator } from "../src/usage-refresh-coordinator";
import type { UsageClientPort, UsageFetchResult } from "../src/usage-client";
import { createUsageStateStore } from "../src/usage-state";
import type { UsageSnapshot } from "../src/usage-snapshot";

const credentials = {
  accessToken: "test-codex-token",
  accountId: "acct-test",
};

const cachedSnapshot: UsageSnapshot = {
  fiveHourLeftPercent: 88,
  sevenDayLeftPercent: 73,
  fiveHourResetInSeconds: 300,
  sevenDayResetInSeconds: 600,
  isLimited: false,
};

function rawUsageResponse(options: { fiveHourUsedPercent?: number } = {}): unknown {
  return {
    rate_limit: {
      primary_window: {
        used_percent: options.fiveHourUsedPercent ?? 12,
        reset_after_seconds: 300,
      },
      secondary_window: {
        used_percent: 44,
        reset_after_seconds: 600,
      },
    },
  };
}

function rawUsageResponseWithSparkBucket(): unknown {
  return {
    rate_limit: {
      primary_window: { used_percent: 12, reset_after_seconds: 300 },
      secondary_window: { used_percent: 44, reset_after_seconds: 600 },
    },
    additional_rate_limits: {
      spark: {
        limit_name: "GPT-5.3-Codex-Spark",
        rate_limit: {
          primary_window: { used_percent: 40, reset_after_seconds: 900 },
          secondary_window: { used_percent: 30, reset_after_seconds: 1_200 },
        },
      },
    },
  };
}

function successfulUsageFetchResult(raw: unknown = rawUsageResponse()): UsageFetchResult {
  return { ok: true, raw, status: 200 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("usage refresh coordinator", () => {
  it("joins concurrent refresh callers onto one in-flight usage request", async () => {
    const inFlightFetch = deferred<UsageFetchResult>();
    const usageClient = {
      fetchUsage: vi.fn(async () => inFlightFetch.promise),
    } satisfies UsageClientPort;
    const usageState = createUsageStateStore();
    const coordinator = createUsageRefreshCoordinator({ usageClient, usageState });

    const firstRefresh = coordinator.refresh({
      credentials,
      staleAfterMs: 60_000,
      modelId: "gpt-codex",
    });
    await Promise.resolve();
    const joinedRefresh = coordinator.refresh({
      credentials,
      staleAfterMs: 60_000,
      modelId: "gpt-codex",
      force: true,
    });

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);

    inFlightFetch.resolve(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 20 })));

    await expect(firstRefresh).resolves.toMatchObject({ status: "refreshed", joined: false });
    await expect(joinedRefresh).resolves.toMatchObject({ status: "refreshed", joined: true });
    expect(usageState.getSnapshot()).toMatchObject({ fiveHourLeftPercent: 80 });
  });

  it("skips non-forced refreshes while the cached snapshot is still fresh", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(cachedSnapshot, new Date("2026-01-01T00:00:00.000Z"));
    const coordinator = createUsageRefreshCoordinator({
      usageClient,
      usageState,
      now: () => new Date("2026-01-01T00:00:30.000Z"),
    });

    await expect(
      coordinator.refresh({ credentials, staleAfterMs: 60_000, modelId: "gpt-codex" }),
    ).resolves.toMatchObject({ status: "skipped", reason: "fresh", joined: false });

    expect(usageClient.fetchUsage).not.toHaveBeenCalled();
    expect(usageState.getSnapshot()).toEqual(cachedSnapshot);
  });

  it("re-parses fresh cached usage for the caller's current model", async () => {
    const raw = rawUsageResponseWithSparkBucket();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const usageState = createUsageStateStore();
    const coordinator = createUsageRefreshCoordinator({
      usageClient,
      usageState,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(
      coordinator.refresh({ credentials, staleAfterMs: 60_000, modelId: "gpt-codex" }),
    ).resolves.toMatchObject({
      status: "refreshed",
      snapshot: { fiveHourLeftPercent: 88, sevenDayLeftPercent: 56 },
    });

    await expect(
      coordinator.refresh({
        credentials,
        staleAfterMs: 60_000,
        modelId: "gpt-5.3-codex-spark",
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "fresh",
      snapshot: { fiveHourLeftPercent: 60, sevenDayLeftPercent: 70 },
    });

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
  });

  it("returns model-specific snapshots to refresh callers that join an in-flight request", async () => {
    const inFlightFetch = deferred<UsageFetchResult>();
    const usageClient = {
      fetchUsage: vi.fn(async () => inFlightFetch.promise),
    } satisfies UsageClientPort;
    const coordinator = createUsageRefreshCoordinator({ usageClient });

    const rootRefresh = coordinator.refresh({
      credentials,
      staleAfterMs: 60_000,
      modelId: "gpt-codex",
    });
    await Promise.resolve();
    const sparkRefresh = coordinator.refresh({
      credentials,
      staleAfterMs: 60_000,
      modelId: "gpt-5.3-codex-spark",
      force: true,
    });

    inFlightFetch.resolve(successfulUsageFetchResult(rawUsageResponseWithSparkBucket()));

    await expect(rootRefresh).resolves.toMatchObject({
      status: "refreshed",
      joined: false,
      snapshot: { fiveHourLeftPercent: 88, sevenDayLeftPercent: 56 },
    });
    await expect(sparkRefresh).resolves.toMatchObject({
      status: "refreshed",
      joined: true,
      snapshot: { fiveHourLeftPercent: 60, sevenDayLeftPercent: 70 },
    });
    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight refresh request", async () => {
    let abortSignal: AbortSignal | undefined;
    const usageClient = {
      fetchUsage: vi.fn(async (_credentials, options) =>
        new Promise<UsageFetchResult>((resolve) => {
          const signal = options?.signal;
          abortSignal = signal;

          const onAbort = () =>
            resolve({
              ok: false,
              error: { kind: "aborted", message: "Codex usage request was aborted" },
            });

          if (signal?.aborted) {
            onAbort();
            return;
          }

          signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ),
    } satisfies UsageClientPort;
    const coordinator = createUsageRefreshCoordinator({ usageClient });

    const refreshResult = coordinator.refresh({ credentials, staleAfterMs: 60_000, modelId: "gpt-codex" });

    await Promise.resolve();
    coordinator.abortInFlightRefresh();

    await expect(refreshResult).resolves.toMatchObject({
      status: "failed",
      error: { kind: "aborted" },
      joined: false,
    });

    expect(abortSignal?.aborted).toBe(true);
    expect(coordinator.isRefreshing()).toBe(false);
  });
});
