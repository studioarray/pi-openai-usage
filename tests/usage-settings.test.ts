import { join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  CONFIG_BASENAME,
  DEFAULT_USAGE_CONFIG,
  type LoadedUsageConfig,
  type UsageConfig,
  loadUsageConfig,
} from "../src/config";
import {
  registerOpenAIUsageSettingsCommand,
  type UsageSettingsCommandDependencies,
} from "../src/usage-settings";
import { registerUsageStatusController } from "../src/status-controller";
import { formatUsageStatusLine } from "../src/format";
import { createUsageRefreshCoordinator, type UsageRefreshCoordinator } from "../src/usage-refresh-coordinator";
import { parseUsageSnapshot } from "../src/usage-snapshot";
import { createUsageStateStore, type UsageStateStore } from "../src/usage-state";
import type { CodexCredentialResolution } from "../src/auth";
import type { UsageClientPort, UsageFetchError, UsageFetchResult } from "../src/usage-client";

type RegisteredCommand = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type SettingsHarness = {
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
      accountId: "acct-test-1234",
      source: "registry",
      toJSON() {
        return { accessToken: "<redacted>", accountId: "acct-…", source: "registry" };
      },
    },
    diagnostics: {
      source: "registry",
      checkedSources: ["registry"],
      hasAccessToken: true,
      hasAccountId: true,
      accountId: "acct-…",
    },
    toJSON() {
      return {
        ok: true,
        credentials: { accessToken: "<redacted>", accountId: "acct-…", source: "registry" },
        diagnostics: {
          source: "registry",
          checkedSources: ["registry"],
          hasAccessToken: true,
          hasAccountId: true,
          accountId: "acct-…",
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

function buildLoadedConfig(effective: UsageConfig): LoadedUsageConfig {
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

function failedUsageFetchResult(error: UsageFetchError): UsageFetchResult {
  return { ok: false, error };
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

function statusLineFromRaw(raw: unknown, config: UsageConfig = DEFAULT_USAGE_CONFIG): string {
  const snapshot = parseUsageSnapshot(raw, { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) });
  return formatUsageStatusLine({ snapshot, config })!;
}

function createSettingsHarness(options: {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: () => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
  usageState?: UsageStateStore;
  now?: () => Date;
  hasUI?: boolean;
  select?: ReturnType<typeof vi.fn<(title: string, options: string[]) => Promise<string | undefined>>>;
} = {}): SettingsHarness {
  let command: RegisteredCommand | undefined;

  const pi = {
    registerCommand: vi.fn((name: string, definition: { handler: RegisteredCommand }) => {
      if (name === "openai-usage-settings") {
        command = definition.handler;
      }
    }),
  } as unknown as ExtensionAPI;

  const usageState = options.usageState ?? createUsageStateStore();
  const usageClient = options.usageClient ?? {
    fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
  } satisfies UsageClientPort;
  const usageRefreshCoordinator =
    options.usageRefreshCoordinator ??
    createUsageRefreshCoordinator({
      usageClient,
      usageState,
      now: options.now,
    });
  const dep: UsageSettingsCommandDependencies = {
    loadConfig: options.loadConfig ?? (() => buildLoadedConfig(DEFAULT_USAGE_CONFIG)),
    resolveCredentials: options.resolveCredentials
      ? async () => options.resolveCredentials!()
      : async () => successfulCredentialResolution(),
    usageClient,
    usageState,
    usageRefreshCoordinator,
  };

  registerOpenAIUsageSettingsCommand(pi, dep);

  const ctx = {
    hasUI: options.hasUI ?? false,
    ui: {
      notify: vi.fn(),
      ...(options.select === undefined ? {} : { select: options.select }),
    },
    model: { provider: "openai", id: "any-openai-model" },
    signal: undefined,
    modelRegistry: {
      isUsingOAuth: vi.fn(() => true),
      getApiKeyForProvider: vi.fn(async () => "access-token"),
    },
  } as unknown as ExtensionCommandContext;

  return {
    command: command ?? (async () => {
      throw new Error("Command handler not registered");
    }),
    ctx,
    usageClient,
    usageState,
  };
}

function lastNotifyText(ctx: ExtensionCommandContext): string {
  const calls = vi.mocked(ctx.ui.notify).mock.calls;
  const last = calls.at(-1) as [string, string?] | undefined;
  return last?.[0] ?? "";
}

function createTempProject() {
  const root = mkdtempSync(join(tmpdir(), "pi-openai-usage-settings-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, cwd, home };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("usage settings command", () => {
  it("dispatches usage utility to the old no-arg usage query behavior", async () => {
    const raw = rawUsageResponse();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({ usageClient });

    await command("usage", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(raw));
  });

  it("shows fresh cached usage from the usage utility without refreshing", async () => {
    const raw = rawUsageResponse();
    const snapshot = parseUsageSnapshot(raw, { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(snapshot, new Date("2026-01-01T00:00:00.000Z"));
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({
      usageClient,
      usageState,
      now: () => new Date("2026-01-01T00:00:30.000Z"),
    });

    await command("usage", ctx);

    expect(usageClient.fetchUsage).not.toHaveBeenCalled();
    expect(lastNotifyText(ctx)).toBe(formatUsageStatusLine({ snapshot, config: DEFAULT_USAGE_CONFIG }));
  });

  it("forces refresh from the refresh utility even when cached usage is fresh", async () => {
    const cachedSnapshot = parseUsageSnapshot(rawUsageResponse(), {
      modelId: "any-openai-model",
      nowMs: Date.UTC(2026, 0, 1),
    });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(cachedSnapshot, new Date("2026-01-01T00:00:00.000Z"));

    const refreshedRaw = rawUsageResponse({
      fiveHourUsedPercent: 9,
      sevenDayUsedPercent: 11,
      fiveHourResetAfterSeconds: 120,
      sevenDayResetAfterSeconds: 420,
    });
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(refreshedRaw)),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({
      usageClient,
      usageState,
      now: () => new Date("2026-01-01T00:00:30.000Z"),
    });

    await command("refresh", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(refreshedRaw));
  });

  it("joins a status-controller refresh through the shared coordinator", async () => {
    type RegisteredHandler = (event: { type: string }, ctx: ExtensionCommandContext) => unknown;

    const inFlightFetch = deferred<UsageFetchResult>();
    const refreshedRaw = rawUsageResponse({ fiveHourUsedPercent: 18, sevenDayUsedPercent: 24 });
    const usageClient = {
      fetchUsage: vi.fn(async () => inFlightFetch.promise),
    } satisfies UsageClientPort;
    const usageState = createUsageStateStore();
    const usageRefreshCoordinator = createUsageRefreshCoordinator({ usageClient, usageState });
    const handlers = new Map<string, RegisteredHandler[]>();
    let settingsCommand: RegisteredCommand | undefined;
    const loadConfig = () => buildLoadedConfig(DEFAULT_USAGE_CONFIG);
    const resolveCredentials = async () => successfulCredentialResolution();

    const pi = {
      on(eventName: string, handler: RegisteredHandler) {
        const eventHandlers = handlers.get(eventName) ?? [];
        eventHandlers.push(handler);
        handlers.set(eventName, eventHandlers);
      },
      registerCommand(name: string, definition: { handler: RegisteredCommand }) {
        if (name === "openai-usage-settings") {
          settingsCommand = definition.handler;
        }
      },
    } as unknown as ExtensionAPI;

    registerUsageStatusController(pi, {
      loadConfig,
      resolveCredentials,
      usageClient,
      usageState,
      usageRefreshCoordinator,
      timerApi: {
        setInterval: vi.fn(() => ({ id: "unused" })),
        clearInterval: vi.fn(),
      },
    });
    registerOpenAIUsageSettingsCommand(pi, {
      loadConfig,
      resolveCredentials,
      usageClient,
      usageState,
      usageRefreshCoordinator,
    });

    const ctx = {
      hasUI: false,
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
      },
      model: { provider: "openai", id: "any-openai-model" },
      signal: undefined,
      modelRegistry: {
        isUsingOAuth: vi.fn(() => true),
        getApiKeyForProvider: vi.fn(async () => "access-token"),
      },
    } as unknown as ExtensionCommandContext;

    const statusRefresh = Promise.all(
      (handlers.get("session_start") ?? []).map((handler) =>
        handler({ type: "session_start" }, ctx),
      ),
    );
    await Promise.resolve();

    const commandRefresh = settingsCommand!("refresh", ctx);
    await Promise.resolve();

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);

    inFlightFetch.resolve(successfulUsageFetchResult(refreshedRaw));
    await Promise.all([statusRefresh, commandRefresh]);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(refreshedRaw));
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", statusLineFromRaw(refreshedRaw));
  });

  it("renders auth-failed status when the refresh utility receives an auth failure", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () =>
        failedUsageFetchResult({
          kind: "auth",
          status: 401,
          message: "Codex usage authentication failed for token: secret-token",
        }),
      ),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({ usageClient });

    await command("refresh", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe("Usage auth failed");
    expect(lastNotifyText(ctx)).not.toContain("secret-token");
  });

  it("renders refresh-failed status when the refresh utility fails without cached usage", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () =>
        failedUsageFetchResult({ kind: "network", status: 503, message: "temporary outage" }),
      ),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({ usageClient });

    await command("refresh", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe("Usage refresh failed");
  });

  it("renders cached usage with the refresh-failed marker when the refresh utility fails with cache", async () => {
    const cachedRaw = rawUsageResponse({ fiveHourUsedPercent: 15, sevenDayUsedPercent: 25 });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      parseUsageSnapshot(cachedRaw, { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) }),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const usageClient = {
      fetchUsage: vi.fn(async () =>
        failedUsageFetchResult({ kind: "network", status: 503, message: "temporary outage" }),
      ),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({ usageClient, usageState });

    await command("refresh", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(`${statusLineFromRaw(cachedRaw)} (refresh failed)`);
  });

  it("uses the effective refresh interval to decide when cached usage is stale", async () => {
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      parseUsageSnapshot(rawUsageResponse(), { modelId: "any-openai-model", nowMs: Date.UTC(2026, 0, 1) }),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const refreshedRaw = rawUsageResponse({ fiveHourUsedPercent: 33, sevenDayUsedPercent: 22 });
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(refreshedRaw)),
    } satisfies UsageClientPort;
    let now = new Date("2026-01-01T00:01:00.000Z");
    const effectiveConfig = { ...DEFAULT_USAGE_CONFIG, refreshIntervalMs: 120_000 };
    const { command, ctx } = createSettingsHarness({
      loadConfig: () => buildLoadedConfig(effectiveConfig),
      usageClient,
      usageState,
      now: () => now,
    });

    await command("usage", ctx);
    expect(usageClient.fetchUsage).not.toHaveBeenCalled();

    now = new Date("2026-01-01T00:02:00.000Z");
    await command("usage", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(refreshedRaw, effectiveConfig));
  });

  it("renders refreshed usage with the latest effective config", async () => {
    const raw = rawUsageResponse();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const latestConfig = {
      ...DEFAULT_USAGE_CONFIG,
      display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
    };
    const loadConfig = vi
      .fn<() => LoadedUsageConfig>()
      .mockReturnValueOnce(buildLoadedConfig(DEFAULT_USAGE_CONFIG))
      .mockReturnValue(buildLoadedConfig(latestConfig));
    const { command, ctx } = createSettingsHarness({ loadConfig, usageClient });

    await command("usage", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(raw, latestConfig));
  });

  it("re-renders cached usage for the command context's current model", async () => {
    const raw = rawUsageResponseWithSparkBucket();
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult(raw)),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({
      usageClient,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    await command("usage", ctx);
    expect(lastNotifyText(ctx)).toBe(statusLineFromRaw(raw));

    (ctx as { model: { provider: string; id: string } }).model = {
      provider: "openai-codex",
      id: "gpt-5.3-codex-spark",
    };
    await command("usage", ctx);

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(lastNotifyText(ctx)).toContain("5h ██████░░░░ 60%");
    expect(lastNotifyText(ctx)).toContain("7d ███████░░░ 70%");
  });

  it("shows the existing login-required usage status when credentials are missing", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const { command, ctx } = createSettingsHarness({
      resolveCredentials: async () => failedCredentialResolution(),
      usageClient,
    });

    await command("usage", ctx);

    expect(usageClient.fetchUsage).not.toHaveBeenCalled();
    expect(lastNotifyText(ctx)).toBe("Usage login required");
  });

  it("shows healthy operational status and common settings", async () => {
    const usageState = createUsageStateStore();
    const now = new Date("2024-01-01T12:00:00.000Z");
    usageState.storeSnapshot(
      parseUsageSnapshot({
        rate_limit: {
          primary_window: { used_percent: 13, reset_after_seconds: 100 },
          secondary_window: { used_percent: 27, reset_after_seconds: 1_000 },
        },
      }),
      now,
    );

    const { command, ctx } = createSettingsHarness({
      usageState,
    });

    await command("", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("openai-usage settings");
    expect(text).toContain("status: OK");
    expect(text).toContain("last refreshed: 2024-01-01T12:00:00.000Z");
    expect(text).toContain("enabled: yes");
    expect(text).toContain("display.showAlways");
    expect(text).toContain("display.showLabel");
    expect(text).toContain("display.label");
    expect(text).toContain("display.separator");
    expect(text).toContain("widgets.fiveHour.mode:");
    expect(text).toContain("bar.style:");
    expect(text).toContain("colors.scheme:");
    expect(text).not.toContain("Raw project config:");
    expect(text).not.toContain("Raw global config:");
  });

  it("does not expose diagnostics from the interactive settings picker", async () => {
    const select = vi.fn<(title: string, options: string[]) => Promise<string | undefined>>(
      async () => "Show settings",
    );
    const { command, ctx } = createSettingsHarness({ hasUI: true, select });

    await command("", ctx);

    const options = select.mock.calls.at(-1)?.[1] ?? [];
    expect(select).toHaveBeenCalledWith("openai-usage settings", expect.any(Array));
    expect(options).toContain("Show settings");
    expect(options).toContain("Help");
    expect(options).not.toContain("Diagnostics");
    expect(lastNotifyText(ctx)).toContain("openai-usage settings");
  });

  it("help text does not expose fast-mode controls", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("help", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("/openai-usage-settings");
    expect(text).toContain("Available subcommands:");
    expect(text).not.toContain("fast");
    expect(text).not.toContain("service_tier");
    expect(text).not.toContain("pi-openai-fast");
  });

  it("does not accept fast-mode setting keys", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set fast-mode true", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });

  it("reports setup-required status when auth is missing", async () => {
    const { command, ctx } = createSettingsHarness({
      resolveCredentials: async () => failedCredentialResolution(),
    });

    await command("", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("status: SETUP");
    expect(text).toContain("/login openai-codex");
    expect(text).not.toContain("Auth source: none");
    expect(text).not.toContain("Raw project config:");
  });

  it("updates a common setting and preserves unknown config fields", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const homeConfigPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);

    const initialProjectConfig = {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
      display: {
        ...DEFAULT_USAGE_CONFIG.display,
        label: "before-change",
      },
    };
    writeJson(projectConfigPath, initialProjectConfig);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command("set bar.width 15", ctx);
    const updatedText = lastNotifyText(ctx);
    expect(updatedText).toContain('Updated setting: bar.width = 15');
    expect(updatedText).toContain('bar.width: 15');

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect((persisted.experimental as { keep?: unknown }).keep).toBe(true);
    expect((persisted as { bar?: { width?: unknown } }).bar?.width).toBe(15);
    expect((persisted as { display?: { label?: unknown } }).display?.label).toBe("before-change");

    rmSync(root, { recursive: true, force: true });
    rmSync(homeConfigPath, { recursive: true, force: true });
  });

  it("shows refresh-failed operational status when current error exists", async () => {
    const usageState = createUsageStateStore();
    usageState.recordFetchAttempt(new Date("2024-01-01T12:05:00.000Z"));
    usageState.recordFetchError({ kind: "network", message: "temporary outage", status: 503 });

    const { command, ctx } = createSettingsHarness({
      usageState,
    });

    await command("show", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("status: REFRESH_FAILED");
    expect(text).toContain("currentError: network (503)");
    expect(text).toContain("currentErrorMessage: temporary outage");
  });

  it("supports advanced JSON editing for colors.custom", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        note: "keep",
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const json = `[{"percent": 99, "color": "#123456", "label": "high"}, {"percent": 0, "color": "error"}]`;
    await command(`set colors.custom "${json}"`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain(`Updated setting: colors.custom = "${json}"`);

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { colors?: { custom?: { mode?: string; stops?: unknown[] } } }).colors?.custom;
    expect(custom?.mode).toBe("step");
    expect(custom?.stops).toEqual([
      { percent: 99, color: "#123456", label: "high" },
      { percent: 0, color: "error" },
    ]);
    expect((persisted as { experimental?: { note?: unknown } }).experimental?.note).toBe("keep");

    rmSync(root, { recursive: true, force: true });
  });

  it("preserves existing custom color stops when updating only colors.custom mode", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    const initialCustomStops = [
      { percent: 99, color: "#123456", label: "high" },
      { percent: 0, color: 255 },
    ];

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: initialCustomStops,
        },
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command('set colors.custom \'{"mode":"gradient"}\'', ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain('Updated setting: colors.custom = \'{"mode":"gradient"}\'');

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { colors?: { custom?: { mode?: string; stops?: unknown[] } } }).colors?.custom;
    expect(custom?.mode).toBe("gradient");
    expect(custom?.stops).toEqual(initialCustomStops);

    rmSync(root, { recursive: true, force: true });
  });

  it("supports advanced JSON editing for bar.custom", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, DEFAULT_USAGE_CONFIG);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const json = '{"filled": "█", "empty": "-", "partials": ["+"]}';
    await command(`set bar.custom '${json}'`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Updated setting: bar.custom = '" + json + "'");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { bar?: { custom?: { filled?: string; empty?: string; partials?: string[] } } }).bar?.custom;
    expect(custom?.filled).toBe("█");
    expect(custom?.empty).toBe("-");
    expect(custom?.partials).toEqual(["+"]);

    rmSync(root, { recursive: true, force: true });
  });

  it("supports full JSON config editing and rejects invalid values", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: DEFAULT_USAGE_CONFIG.colors.custom.stops,
        },
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const valid = '{"enabled":false,"bar":{"width":20,"custom":{"filled":"#","empty":"."},"style":"ascii"},"colors":{"custom":{"mode":"gradient","stops":[{"percent":100,"color":"#111111"},{"percent":0,"color":"#222222"}]}}}';
    await command(`set config ${valid}`, ctx);

    let text = lastNotifyText(ctx);
    expect(text).toContain("Updated setting: config = " + valid);

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect((persisted as { enabled?: boolean }).enabled).toBe(false);
    expect((persisted as { bar?: { width?: number } }).bar?.width).toBe(20);
    expect((persisted as { bar?: { custom?: { filled?: string } } }).bar?.custom?.filled).toBe("#");
    expect((persisted as { experimental?: { keep?: unknown } }).experimental?.keep).toBe(true);

    await command("set config {\"refreshIntervalMs\": 1}", ctx);
    text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    rmSync(root, { recursive: true, force: true });
  });

  it("diagnostics include required runtime/config/auth/raw-config data and redact secrets", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const globalConfigPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);
    writeJson(globalConfigPath, {
      enabled: true,
      refreshIntervalMs: 120_000,
      globalOnly: {
        apiKey: "global-api-key-secret",
        note: "keep-global",
      },
    });
    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      enabled: false,
      refreshIntervalMs: 300_000,
      diagnostic: "test",
      accessToken: "project-access-token-secret",
      nested: {
        refresh_token: "project-refresh-token-secret",
        unknownValue: "Bearer project-bearer-token-value",
        apiKey: "sk-proj-projectsecret1234567890",
        array: [
          "plain-value",
          "ghp_projecttoken1234567890",
          { authorization: "Bearer nested-token-abcdef123456" },
        ],
      },
    });
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      {
        fiveHourLeftPercent: 88,
        sevenDayLeftPercent: 44,
        fiveHourResetInSeconds: 300,
        sevenDayResetInSeconds: 600,
        isLimited: false,
      },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    usageState.recordFetchError(
      {
        kind: "network",
        status: 503,
        message: "failed with Bearer runtime-bearer-token-value",
      },
      new Date("2026-01-01T00:00:10.000Z"),
    );

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
      usageState,
    });

    await command("diagnostics", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("openai-usage diagnostics");
    expect(text).toContain(`Config path: ${projectConfigPath}`);
    expect(text).toContain(`Project config path: ${projectConfigPath}`);
    expect(text).toContain(`Global config path: ${globalConfigPath}`);
    expect(text).toContain("Project config exists: yes");
    expect(text).toContain("Global config exists: yes");
    expect(text).toContain("Endpoint:");
    expect(text).toContain("Runtime:");
    expect(text).toContain("Model ID: any-openai-model");
    expect(text).toContain("Last fetch: 2026-01-01T00:00:10.000Z");
    expect(text).toContain("Last success: 2026-01-01T00:00:00.000Z");
    expect(text).toContain("Last error: network (503): failed with Bearer <redacted>");
    expect(text).toContain("Auth source: registry");
    expect(text).toContain("Checked auth sources: registry");
    expect(text).toContain("Has access token: yes");
    expect(text).toContain("Has account ID: yes");
    expect(text).toContain("Credential source: registry");
    expect(text).toContain("Effective enabled: no");
    expect(text).toContain("Effective refresh interval (ms): 300000");
    expect(text).toContain("Raw project config:");
    expect(text).toContain("Raw global config:");
    expect(text).toContain('"diagnostic": "test"');
    expect(text).toContain('"note": "keep-global"');
    expect(text).toContain('"plain-value"');
    expect(text).toContain("<redacted>");
    expect(text).not.toContain("project-access-token-secret");
    expect(text).not.toContain("project-refresh-token-secret");
    expect(text).not.toContain("project-bearer-token-value");
    expect(text).not.toContain("sk-proj-projectsecret1234567890");
    expect(text).not.toContain("ghp_projecttoken1234567890");
    expect(text).not.toContain("nested-token-abcdef123456");
    expect(text).not.toContain("global-api-key-secret");
    expect(text).not.toContain("runtime-bearer-token-value");
    expect(text).not.toContain("test-codex-token");

    rmSync(root, { recursive: true, force: true });
  });

  it("diagnostics include setup guidance when credentials are missing", async () => {
    const { command, ctx } = createSettingsHarness({
      resolveCredentials: async () => failedCredentialResolution(),
    });

    await command("diagnostics", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Credential error: Missing openai-codex OAuth credentials. Run /login openai-codex.");
    expect(text).toContain("Checked auth sources: registry, auth_file");
    expect(text).toContain("Has access token: no");
    expect(text).toContain("Has account ID: no");
  });

  it("rejects invalid advanced JSON payloads", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const original = {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
    };
    writeJson(projectConfigPath, original);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command('set config {"enabled": true', ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(original);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects invalid advanced JSON values without applying partial changes", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const original = {
      ...DEFAULT_USAGE_CONFIG,
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: [{ percent: 100, color: "success" }],
        },
      },
    };
    writeJson(projectConfigPath, original);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command(`set colors.custom '[{"percent":100,"color":true}]'`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(original);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects malformed integer settings values", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set refreshIntervalMs 12abc", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });

  it("rejects out-of-range common refresh interval settings", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set refreshIntervalMs 1", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });
});
