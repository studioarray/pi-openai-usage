import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  CONFIG_BASENAME,
  DEFAULT_USAGE_CONFIG,
  type LoadedUsageConfig,
  type UsageConfig,
  type UsageConfigPatch,
  loadUsageConfig,
  patchUsageConfig,
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
type ArgumentCompletion = { value: string; label?: string };
type ArgumentCompletionProvider = (
  argumentPrefix: string,
) => ArgumentCompletion[] | null | Promise<ArgumentCompletion[] | null>;

type SettingsHarness = {
  command: RegisteredCommand;
  getArgumentCompletions: ArgumentCompletionProvider;
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
  custom?: ExtensionCommandContext["ui"]["custom"];
  onConfigChanged?: UsageSettingsCommandDependencies["onConfigChanged"];
  reapplyStatusLine?: UsageSettingsCommandDependencies["reapplyStatusLine"];
  patchConfig?: UsageSettingsCommandDependencies["patchConfig"];
} = {}): SettingsHarness {
  let command: RegisteredCommand | undefined;
  let getArgumentCompletions: ArgumentCompletionProvider | undefined;

  const pi = {
    registerCommand: vi.fn((name: string, definition: { handler: RegisteredCommand; getArgumentCompletions?: ArgumentCompletionProvider }) => {
      if (name === "openai-usage-settings") {
        command = definition.handler;
        getArgumentCompletions = definition.getArgumentCompletions;
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
    onConfigChanged: options.onConfigChanged,
    reapplyStatusLine: options.reapplyStatusLine,
    patchConfig: options.patchConfig,
  };

  registerOpenAIUsageSettingsCommand(pi, dep);

  const ctx = {
    hasUI: options.hasUI ?? false,
    ui: {
      notify: vi.fn(),
      ...(options.custom === undefined ? {} : { custom: options.custom }),
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
    getArgumentCompletions: getArgumentCompletions ?? (() => {
      throw new Error("Command completions not registered");
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

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function mergeExpectedPatch(
  current: Record<string, unknown>,
  patch: UsageConfigPatch,
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch) as Array<[
    keyof UsageConfigPatch,
    UsageConfigPatch[keyof UsageConfigPatch],
  ]>) {
    if (value === undefined) continue;
    if (isRecord(value)) {
      next[key] = mergeExpectedPatch(isRecord(next[key]) ? next[key] : {}, value as UsageConfigPatch);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe("usage settings command", () => {
  it("completes only supported utility subcommands", async () => {
    const { getArgumentCompletions } = createSettingsHarness();

    await expect(Promise.resolve(getArgumentCompletions(""))).resolves.toEqual([
      { value: "usage", label: "usage" },
      { value: "refresh", label: "refresh" },
      { value: "diagnostics", label: "diagnostics" },
      { value: "help", label: "help" },
    ]);
    await expect(Promise.resolve(getArgumentCompletions("d"))).resolves.toEqual([
      { value: "diagnostics", label: "diagnostics" },
    ]);
    await expect(Promise.resolve(getArgumentCompletions("s"))).resolves.toBeNull();
  });

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

  it("shows a read-only non-UI fallback for no-args", async () => {
    const loadConfig = vi.fn(() => buildLoadedConfig(DEFAULT_USAGE_CONFIG));
    const resolveCredentials = vi.fn(async () => successfulCredentialResolution());
    const { command, ctx } = createSettingsHarness({ loadConfig, resolveCredentials });

    await command("", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Interactive settings require UI");
    expect(text).toContain("/openai-usage-settings usage");
    expect(text).toContain("/openai-usage-settings refresh");
    expect(text).toContain("/openai-usage-settings diagnostics");
    expect(text).toContain("/openai-usage-settings help");
    expect(text).not.toMatch(/^\s*set\b/m);
    expect(text).not.toMatch(/^\s*show\b/m);
    expect(text).not.toMatch(/^\s*debug\b/m);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveCredentials).not.toHaveBeenCalled();
  });

  it("opens a SettingsList with exactly the approved rows for no-args UI", async () => {
    let capturedRows: Array<{ label: string }> = [];
    const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
      const component = await factory({} as never, {} as never, {} as never, () => undefined);
      capturedRows = (component as { items?: Array<{ label: string }> }).items ?? [];
      return undefined;
    });
    const { command, ctx } = createSettingsHarness({
      hasUI: true,
      custom: custom as ExtensionCommandContext["ui"]["custom"],
    });

    await command("", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    const rowLabels = capturedRows.map((row) => row.label);
    expect(rowLabels).toEqual([
      "Display",
      "Color scheme",
      "Bar style",
      "Bar width",
      "5h display",
      "7d display",
      "5h reset display",
      "7d reset display",
      "Refresh interval",
      "Hide label",
    ]);
    const normalizedRowLabels = rowLabels.map((label) => label.toLowerCase());
    expect(normalizedRowLabels).not.toEqual(
      expect.arrayContaining([
        "help",
        "refresh now",
        "show current usage",
        "diagnostics",
        "json editor",
        "json editors",
        "raw config",
        "label text",
        "separator",
        "partial bars",
        "color target",
        "gradient",
        "gradients",
      ]),
    );
    expect(lastNotifyText(ctx)).toBe("");
  });

  it("leaves config untouched when the interactive menu is cancelled", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const initialConfig = {
      enabled: true,
      display: { label: "Keep me", separator: " · ", showLabel: true },
      futureTopLevel: { keep: true },
    };
    writeJson(projectConfigPath, initialConfig);
    let cancelDoneCalled = false;
    const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
      const component = await factory({} as never, {} as never, {} as never, () => {
        cancelDoneCalled = true;
      });
      component.handleInput?.("\x1b");
      return undefined;
    });
    const onConfigChanged = vi.fn();
    const reapplyStatusLine = vi.fn();
    const { command, ctx } = createSettingsHarness({
      hasUI: true,
      loadConfig: () => loadUsageConfig({ cwd, home }),
      custom: custom as ExtensionCommandContext["ui"]["custom"],
      onConfigChanged,
      reapplyStatusLine,
    });

    await command("", ctx);
    await flushMicrotasks();

    expect(cancelDoneCalled).toBe(true);
    expect(JSON.parse(readFileSync(projectConfigPath, "utf8")) as unknown).toEqual(initialConfig);
    expect(onConfigChanged).not.toHaveBeenCalled();
    expect(reapplyStatusLine).not.toHaveBeenCalled();

    rmSync(root, { recursive: true, force: true });
  });

  it("patch-writes every menu row to the selected target and reapplies after config changes", async () => {
    const rowWrites: Array<{
      rowIndex: number;
      expectedPatch: UsageConfigPatch;
      expectedPersistedFields: Record<string, unknown>;
    }> = [
      {
        rowIndex: 0,
        expectedPatch: { enabled: false, display: { showAlways: false } },
        expectedPersistedFields: { enabled: false, display: { showAlways: false } },
      },
      {
        rowIndex: 1,
        expectedPatch: { colors: { scheme: "cyan" } },
        expectedPersistedFields: { colors: { scheme: "cyan" } },
      },
      {
        rowIndex: 2,
        expectedPatch: { bar: { style: "thin" } },
        expectedPersistedFields: { bar: { style: "thin" } },
      },
      {
        rowIndex: 3,
        expectedPatch: { bar: { width: 12 } },
        expectedPersistedFields: { bar: { width: 12 } },
      },
      {
        rowIndex: 4,
        expectedPatch: { widgets: { fiveHour: { enabled: false, mode: "hidden" } } },
        expectedPersistedFields: { widgets: { fiveHour: { enabled: false, mode: "hidden" } } },
      },
      {
        rowIndex: 5,
        expectedPatch: { widgets: { sevenDay: { enabled: false, mode: "hidden" } } },
        expectedPersistedFields: { widgets: { sevenDay: { enabled: false, mode: "hidden" } } },
      },
      {
        rowIndex: 6,
        expectedPatch: { widgets: { fiveHourReset: { enabled: true, mode: "clock" } } },
        expectedPersistedFields: { widgets: { fiveHourReset: { enabled: true, mode: "clock" } } },
      },
      {
        rowIndex: 7,
        expectedPatch: { widgets: { sevenDayReset: { enabled: true, mode: "clock" } } },
        expectedPersistedFields: { widgets: { sevenDayReset: { enabled: true, mode: "clock" } } },
      },
      {
        rowIndex: 8,
        expectedPatch: { refreshIntervalMs: 120_000 },
        expectedPersistedFields: { refreshIntervalMs: 120_000 },
      },
      {
        rowIndex: 9,
        expectedPatch: { display: { showLabel: false } },
        expectedPersistedFields: { display: { showLabel: false } },
      },
    ];

    for (const [writeIndex, rowWrite] of rowWrites.entries()) {
      const { cwd, home, root } = createTempProject();
      try {
        const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        const globalConfigPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);
        const initialProjectConfig = {
          enabled: true,
          refreshIntervalMs: 60_000,
          display: {
            showAlways: false,
            showLabel: true,
            label: "Project Usage",
            separator: " · ",
            futureDisplay: { keep: true },
          },
          widgets: {
            fiveHour: { enabled: true, label: "short", mode: "bar-percent", future: "keep" },
            sevenDay: { enabled: true, label: "week", mode: "bar-percent", future: "keep" },
            fiveHourReset: {
              enabled: true,
              label: "short reset",
              mode: "countdown",
              future: "keep",
            },
            sevenDayReset: {
              enabled: true,
              label: "week reset",
              mode: "countdown",
              future: "keep",
            },
            futureWidgets: { keep: true },
          },
          bar: {
            style: "blocks",
            width: 10,
            custom: { filled: "X", empty: "_", partials: ["a", "b"] },
            futureBar: { keep: true },
          },
          colors: {
            scheme: "traffic",
            target: "bar",
            custom: {
              mode: "step",
              stops: [{ percent: 100, color: "success" }],
            },
            futureColors: { keep: true },
          },
          futureTopLevel: { keep: true },
        };
        const initialGlobalConfig = {
          enabled: false,
          globalOnly: { keep: true },
        };
        writeJson(projectConfigPath, initialProjectConfig);
        writeJson(globalConfigPath, initialGlobalConfig);

        let capturedPatch: UsageConfigPatch | undefined;
        const patchConfig = vi.fn((configPath: string, patch: UsageConfigPatch) => {
          capturedPatch = patch;
          patchUsageConfig(configPath, patch);
        });
        const sideEffects: string[] = [];
        const onConfigChanged = vi.fn(() => {
          sideEffects.push("configChanged");
        });
        const reapplyStatusLine = vi.fn(() => {
          sideEffects.push("reapply");
        });
        const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
          const component = await factory({} as never, {} as never, {} as never, () => undefined);
          for (let count = 0; count < rowWrite.rowIndex; count += 1) {
            component.handleInput?.("\x1b[B");
          }
          component.handleInput?.("\r");
          return undefined;
        });
        const { command, ctx } = createSettingsHarness({
          hasUI: true,
          loadConfig: () => loadUsageConfig({ cwd, home }),
          custom: custom as ExtensionCommandContext["ui"]["custom"],
          patchConfig,
          onConfigChanged,
          reapplyStatusLine,
        });

        await command("", ctx);
        await flushMicrotasks();

        expect(capturedPatch, `row ${writeIndex}`).toEqual(rowWrite.expectedPatch);
        expect(patchConfig, `row ${writeIndex}`).toHaveBeenCalledWith(
          projectConfigPath,
          rowWrite.expectedPatch,
        );
        expect(onConfigChanged, `row ${writeIndex}`).toHaveBeenCalledTimes(1);
        expect(onConfigChanged, `row ${writeIndex}`).toHaveBeenCalledWith(ctx);
        expect(reapplyStatusLine, `row ${writeIndex}`).toHaveBeenCalledTimes(1);
        expect(reapplyStatusLine, `row ${writeIndex}`).toHaveBeenCalledWith(ctx);
        expect(sideEffects, `row ${writeIndex}`).toEqual(["configChanged", "reapply"]);
        expect(readJson(projectConfigPath), `row ${writeIndex}`).toEqual(
          mergeExpectedPatch(initialProjectConfig, rowWrite.expectedPersistedFields),
        );
        expect(readJson(globalConfigPath), `row ${writeIndex}`).toEqual(initialGlobalConfig);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("writes to the selected global target and creates parent directories when no project config exists", async () => {
    const { cwd, home, root } = createTempProject();
    try {
      const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      const globalConfigPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);
      const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
        const component = await factory({} as never, {} as never, {} as never, () => undefined);
        component.handleInput?.("\r");
        return undefined;
      });
      const onConfigChanged = vi.fn();
      const reapplyStatusLine = vi.fn();
      const { command, ctx } = createSettingsHarness({
        hasUI: true,
        loadConfig: () => loadUsageConfig({ cwd, home }),
        custom: custom as ExtensionCommandContext["ui"]["custom"],
        onConfigChanged,
        reapplyStatusLine,
      });

      await command("", ctx);
      await flushMicrotasks();

      expect(existsSync(projectConfigPath)).toBe(false);
      expect(readJson(globalConfigPath)).toEqual({
        enabled: false,
        display: { showAlways: false },
      });
      expect(onConfigChanged).toHaveBeenCalledTimes(1);
      expect(reapplyStatusLine).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not run config-change side effects when a menu write fails", async () => {
    const { cwd, home, root } = createTempProject();
    try {
      const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      const initialConfig = { enabled: true, display: { showAlways: false } };
      writeJson(projectConfigPath, initialConfig);
      const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
        const component = await factory({} as never, {} as never, {} as never, () => undefined);
        component.handleInput?.("\r");
        return undefined;
      });
      const onConfigChanged = vi.fn();
      const reapplyStatusLine = vi.fn();
      const { command, ctx } = createSettingsHarness({
        hasUI: true,
        loadConfig: () => loadUsageConfig({ cwd, home }),
        custom: custom as ExtensionCommandContext["ui"]["custom"],
        patchConfig: vi.fn(() => {
          throw new Error("disk full");
        }),
        onConfigChanged,
        reapplyStatusLine,
      });

      await expect(command("", ctx)).resolves.toBeUndefined();
      await flushMicrotasks();

      expect(readJson(projectConfigPath)).toEqual(initialConfig);
      expect(onConfigChanged).not.toHaveBeenCalled();
      expect(reapplyStatusLine).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not run config-change side effects for invalid menu selections", async () => {
    const { cwd, home, root } = createTempProject();
    try {
      const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      const initialConfig = { enabled: true, display: { showAlways: false } };
      writeJson(projectConfigPath, initialConfig);
      const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
        const component = await factory({} as never, {} as never, {} as never, () => undefined);
        const onChange = (component as unknown as { onChange: (id: string, value: string) => void }).onChange;
        onChange("display", "invalid");
        onChange("unknown-row", "On");
        return undefined;
      });
      const patchConfig = vi.fn();
      const onConfigChanged = vi.fn();
      const reapplyStatusLine = vi.fn();
      const { command, ctx } = createSettingsHarness({
        hasUI: true,
        loadConfig: () => loadUsageConfig({ cwd, home }),
        custom: custom as ExtensionCommandContext["ui"]["custom"],
        patchConfig,
        onConfigChanged,
        reapplyStatusLine,
      });

      await command("", ctx);
      await flushMicrotasks();

      expect(patchConfig).not.toHaveBeenCalled();
      expect(readJson(projectConfigPath)).toEqual(initialConfig);
      expect(onConfigChanged).not.toHaveBeenCalled();
      expect(reapplyStatusLine).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("help describes the one-command surface", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("help", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("/openai-usage-settings is the only OpenAI usage/settings command");
    expect(text).toContain("  usage");
    expect(text).toContain("  refresh");
    expect(text).toContain("  diagnostics");
    expect(text).toContain("  help");
    expect(text).toContain("Common settings are interactive through no-args /openai-usage-settings");
    expect(text).toContain("Advanced settings are JSON-file-only");
    expect(text).not.toMatch(/^\s*set\b/m);
    expect(text).not.toMatch(/^\s*show\b/m);
    expect(text).not.toMatch(/^\s*debug\b/m);
    expect(text).not.toContain("fast");
    expect(text).not.toContain("service_tier");
    expect(text).not.toContain("pi-openai-fast");
  });

  it("does not accept show or debug as aliases", async () => {
    const loadConfig = vi.fn(() => buildLoadedConfig(DEFAULT_USAGE_CONFIG));
    const { command, ctx } = createSettingsHarness({ loadConfig });

    await command("show", ctx);
    const showText = lastNotifyText(ctx);
    expect(showText).toContain("removed");
    expect(showText).toContain("/openai-usage-settings help");
    expect(showText).not.toContain("openai-usage settings");

    await command("debug", ctx);
    const debugText = lastNotifyText(ctx);
    expect(debugText).toContain("not a diagnostics alias");
    expect(debugText).toContain("/openai-usage-settings diagnostics");
    expect(debugText).toContain("/openai-usage-settings help");
    expect(debugText).not.toContain("openai-usage diagnostics");

    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("points unknown subcommands to help", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("bogus", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Unknown /openai-usage-settings subcommand");
    expect(text).toContain("/openai-usage-settings help");
  });

  it("treats set as a removed non-mutating path", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
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

    const loadConfig = vi.fn(() => loadUsageConfig({ cwd, home }));
    const { command, ctx } = createSettingsHarness({
      loadConfig,
    });

    await command("set bar.width 15", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Slash-command setting writes were removed");
    expect(text).toContain("settings are interactive now");
    expect(text).toMatch(/advanced settings can be edited in the JSON config file/i);

    expect(loadConfig).not.toHaveBeenCalled();
    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(initialProjectConfig);

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

});
