import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { registerOpenAIUsageCommand, type UsageCommandDependencies } from "../src/usage-command";
import { parseUsageSnapshot } from "../src/usage-snapshot";
import { DEFAULT_USAGE_CONFIG, type LoadedUsageConfig, type UsageConfig } from "../src/config";
import { createUsageRefreshCoordinator } from "../src/usage-refresh-coordinator";
import { createUsageStateStore, type UsageStateStore } from "../src/usage-state";
import type { UsageClientPort, UsageFetchResult, UsageFetchError } from "../src/usage-client";
import { formatUsageStatusLine } from "../src/format";
import { USAGE_ENDPOINT } from "../src/usage-client";
import type { CodexCredentialResolution } from "../src/auth";

type RegisteredCommand = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type CommandHarness = {
  command: RegisteredCommand;
  ctx: ExtensionCommandContext;
  usageClient: UsageClientPort;
  usageState: UsageStateStore;
};

function successfulCredentialResolution(): CodexCredentialResolution {
  return {
    ok: true,
    credentials: {
      accessToken: "test-codex-token",
      accountId: "acct-test",
      source: "registry",
      toJSON() {
        return { accessToken: "<redacted>", accountId: "…test", source: "registry" };
      },
    },
    diagnostics: {
      source: "registry",
      checkedSources: ["registry"],
      hasAccessToken: true,
      hasAccountId: true,
      accountId: "…test",
    },
    toJSON() {
      return {
        ok: true,
        credentials: { accessToken: "<redacted>", accountId: "…test", source: "registry" },
        diagnostics: {
          source: "registry",
          checkedSources: ["registry"],
          hasAccessToken: true,
          hasAccountId: true,
          accountId: "…test",
        },
      };
    },
  };
}

function failedCredentialResolution(): CodexCredentialResolution {
  return {
    ok: false,
    error: {
      code: "missing_credentials",
      message: "Missing openai-codex OAuth credentials. Run /login openai-codex.",
    },
    diagnostics: {
      source: "none",
      checkedSources: ["registry", "auth_file"],
      hasAccessToken: false,
      hasAccountId: false,
    },
  };
}

function loadedConfig(effective: UsageConfig): LoadedUsageConfig {
  return {
    configPath: "/tmp/project/.pi/extensions/pi-openai-usage.json",
    projectConfigPath: "/tmp/project/.pi/extensions/pi-openai-usage.json",
    globalConfigPath: "/tmp/home/.pi/agent/extensions/pi-openai-usage.json",
    projectConfigExists: true,
    globalConfigExists: false,
    raw: { project: {}, global: {} },
    effective,
  };
}

function rawUsageResponse(
  options: {
    fiveHourUsedPercent?: number;
    sevenDayUsedPercent?: number;
    fiveHourResetAfterSeconds?: number;
    sevenDayResetAfterSeconds?: number;
  } = {},
): unknown {
  return {
    rate_limit: {
      primary_window: {
        used_percent: options.fiveHourUsedPercent ?? 12,
        reset_after_seconds: options.fiveHourResetAfterSeconds ?? 300,
      },
      secondary_window: {
        used_percent: options.sevenDayUsedPercent ?? 44,
        reset_after_seconds: options.sevenDayResetAfterSeconds ?? 600,
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

function createCommandHarness(options: {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: () => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  now?: () => Date;
} = {}): CommandHarness {
  let command: RegisteredCommand | undefined;

  const pi = {
    registerCommand: vi.fn((name: string, definition: { handler: RegisteredCommand }) => {
      if (name === "openai-usage") {
        command = definition.handler;
      }
    }),
  } as unknown as ExtensionAPI;

  const usageState = options.usageState ?? createUsageStateStore();
  const usageClient = options.usageClient ?? {
    fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
  };
  const usageRefreshCoordinator = createUsageRefreshCoordinator({
    usageClient,
    usageState,
    now: options.now,
  });

  const dep: UsageCommandDependencies = {
    loadConfig: options.loadConfig ?? (() => loadedConfig(DEFAULT_USAGE_CONFIG)),
    resolveCredentials: options.resolveCredentials
      ? async () => options.resolveCredentials!()
      : async () => successfulCredentialResolution(),
    usageClient,
    usageState,
    usageRefreshCoordinator,
  };

  registerOpenAIUsageCommand(pi, dep);

  const ctx = {
    ui: {
      notify: vi.fn(),
    },
    model: { provider: "openai", id: "any-openai-model" },
    modelRegistry: {
      isUsingOAuth: vi.fn(() => true),
      getApiKeyForProvider: vi.fn(async () => "access-token"),
    },
    signal: undefined,
  } as unknown as ExtensionCommandContext;

  return {
    command: command ?? (() => Promise.resolve()),
    ctx,
    usageClient,
    usageState,
  };
}

function statusLineFromRaw(
  raw: unknown,
  config: UsageConfig = DEFAULT_USAGE_CONFIG,
): string {
  const snapshot = parseUsageSnapshot(raw, { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) });
  return formatUsageStatusLine({ snapshot, config })!;
}

function lastNotifyText(ctx: ExtensionCommandContext): string {
  const calls = vi.mocked(ctx.ui.notify).mock.calls;
  const last = calls.at(-1) as unknown[] | undefined;
  return (last?.[0] as string) ?? "";
}

describe("usage command", () => {
  it("refreshes before showing usage when cache is missing", async () => {
    const raw = rawUsageResponse();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;

    const harness = createCommandHarness({ usageClient });

    await harness.command("", harness.ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(harness.ctx)).toBe(statusLineFromRaw(raw));
  });

  it("does not refresh for no-args when cached usage is fresh", async () => {
    const effective = DEFAULT_USAGE_CONFIG;
    const snapshot = parseUsageSnapshot(rawUsageResponse(), { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(snapshot, new Date("2026-01-01T00:00:00.000Z"));

    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const now = new Date("2026-01-01T00:00:00.000Z");

    const harness = createCommandHarness({ usageClient, usageState, now: () => now });

    await harness.command("", harness.ctx);

    expect(usageClient.fetchUsage).not.toHaveBeenCalled();
    expect(lastNotifyText(harness.ctx)).toBe(formatUsageStatusLine({ snapshot, config: effective }));
  });

  it("re-renders fresh cached command usage for the current model", async () => {
    const raw = rawUsageResponseWithSparkBucket();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const now = new Date("2026-01-01T00:00:00.000Z");
    const harness = createCommandHarness({ usageClient, now: () => now });

    await harness.command("", harness.ctx);
    expect(lastNotifyText(harness.ctx)).toBe(statusLineFromRaw(raw));

    (harness.ctx as { model: { provider: string; id: string } }).model = {
      provider: "openai-codex",
      id: "gpt-5.3-codex-spark",
    };
    await harness.command("", harness.ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(harness.ctx)).toContain("5h ██████░░░░ 60%");
    expect(lastNotifyText(harness.ctx)).toContain("7d ███████░░░ 70%");
  });

  it("refreshes stale cached usage before showing usage", async () => {
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      parseUsageSnapshot(rawUsageResponse(), { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) }),
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const raw = rawUsageResponse({ fiveHourUsedPercent: 33, sevenDayUsedPercent: 22 });
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const now = new Date("2026-01-01T01:00:00.000Z");

    const harness = createCommandHarness({ usageClient, usageState, now: () => now });

    await harness.command("", harness.ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(harness.ctx)).toBe(statusLineFromRaw(raw));
  });


  it("forces refresh on the refresh subcommand", async () => {
    const snapshot = parseUsageSnapshot(rawUsageResponse(), { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(snapshot, new Date("2026-01-01T00:00:00.000Z"));

    const freshRaw = rawUsageResponse({
      fiveHourUsedPercent: 9,
      sevenDayUsedPercent: 11,
      fiveHourResetAfterSeconds: 120,
      sevenDayResetAfterSeconds: 420,
    });
    const expectedText = statusLineFromRaw(freshRaw);
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(freshRaw)),
    } satisfies UsageClientPort;

    const harness = createCommandHarness({
      usageClient,
      usageState,
    });

    await harness.command("refresh", harness.ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(harness.ctx)).toBe(expectedText);
  });

  it("joins in-flight refreshes for concurrent refresh subcommands", async () => {
    let resolver: ((result: UsageFetchResult) => void) | undefined;
    const usageClient = {
      fetchUsage: vi.fn(() => {
        return new Promise<UsageFetchResult>((resolve) => {
          resolver = resolve;
        });
      }),
    } satisfies UsageClientPort;

    const raw = rawUsageResponse();
    const harness = createCommandHarness({ usageClient });

    const first = harness.command("refresh", harness.ctx);
    const second = harness.command("refresh", harness.ctx);

    await Promise.resolve();
    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);

    resolver!(successfulUsageFetchResult(raw));
    await Promise.all([first, second]);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(harness.ctx.ui.notify).mock.calls).toHaveLength(2);
    expect(lastNotifyText(harness.ctx)).toBe(statusLineFromRaw(raw));
  });

  it("prints diagnostics for the debug subcommand", async () => {
    const loaded = loadedConfig(DEFAULT_USAGE_CONFIG);
    const harness = createCommandHarness({
      loadConfig: () => loaded,
      resolveCredentials: async () => successfulCredentialResolution(),
    });

    harness.usageState.storeSnapshot(
      {
        fiveHourLeftPercent: 88,
        sevenDayLeftPercent: 44,
        fiveHourResetInSeconds: 300,
        sevenDayResetInSeconds: 600,
        isLimited: false,
      },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const failureAt = new Date("2026-01-01T00:00:10.000Z");
    harness.usageState.recordFetchAttempt(failureAt);
    harness.usageState.recordFetchError(
      { kind: "network", message: "temporary failure" } as UsageFetchError,
      failureAt,
    );

    await harness.command("debug", harness.ctx);

    const text = lastNotifyText(harness.ctx);
    expect(text).toContain(`Config path: ${loaded.configPath}`);
    expect(text).toContain(`Project config path: ${loaded.projectConfigPath}`);
    expect(text).toContain(`Global config path: ${loaded.globalConfigPath}`);
    expect(text).toContain("Auth source: registry");
    expect(text).toContain("Account ID: …test");
    expect(text).toContain(`Endpoint: ${USAGE_ENDPOINT}`);
    expect(text).toContain("Last fetch: 2026-01-01T00:00:10.000Z");
    expect(text).toContain("Last success: 2026-01-01T00:00:00.000Z");
    expect(text).toContain("Last error: network: temporary failure");
    expect(text).toContain("Credential source: registry");
  });

  it("prints setup guidance and auth-source details in debug diagnostics when credentials are missing", async () => {
    const harness = createCommandHarness({
      resolveCredentials: async () => failedCredentialResolution(),
    });

    await harness.command("debug", harness.ctx);

    const text = lastNotifyText(harness.ctx);
    expect(text).toContain("Credential error: Missing openai-codex OAuth credentials. Run /login openai-codex.");
    expect(text).toContain("Checked auth sources: registry, auth_file");
    expect(text).toContain("Has access token: no");
    expect(text).toContain("Has account ID: no");
    expect(text).toContain("/login openai-codex");
    expect(text).not.toContain("test-codex-token");
  });

  it("prints help for the help subcommand", async () => {
    const harness = createCommandHarness();

    await harness.command("help", harness.ctx);

    const text = lastNotifyText(harness.ctx);
    expect(text).toContain("Available subcommands:");
    expect(text).toContain("refresh");
    expect(text).toContain("debug");
    expect(text).toContain("help");
  });

  it("help text does not expose fast-mode controls", async () => {
    const harness = createCommandHarness();

    await harness.command("help", harness.ctx);

    const text = lastNotifyText(harness.ctx);
    expect(text).not.toContain("fast");
    expect(text).not.toContain("service_tier");
    expect(text).not.toContain("pi-openai-fast");
  });

  it("notifies login required when credentials are missing", async () => {
    const harness = createCommandHarness({ resolveCredentials: async () => failedCredentialResolution() });

    await harness.command("", harness.ctx);

    expect(lastNotifyText(harness.ctx)).toBe("Usage login required");
  });
});
